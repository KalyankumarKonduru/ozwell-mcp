import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpOzwellClient, mcpSdkClient } from "../mcp/client.js"; 
import { extractTextFromFile, chunkText, generateEmbeddingsForChunks, extractStructuredData } from "../mcp/document-processor.js";

const DOC_PROCESSING_CONFIG = {
  ELASTICSEARCH_INDEX: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX || "ozwell_documents",
  ELASTICSEARCH_INDEX_CHUNKS: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX_CHUNKS || "ozwell_document_chunks",
  CHUNK_SIZE: Meteor.settings.private?.RAG_CHUNK_SIZE || 1000,
  CHUNK_OVERLAP: Meteor.settings.private?.RAG_CHUNK_OVERLAP || 200,
  MAX_CHUNKS: Meteor.settings.private?.RAG_MAX_CHUNKS || 50,
};

Meteor.methods({
  async "messages.send"(text, fileUploadInfo = null) {
    check(text, String);
    if (fileUploadInfo) {
      check(fileUploadInfo, {
        name: String,
        type: String,
        size: Number,
        data: String
      });
    }

    const userName = this.userId ? (Meteor.users.findOne(this.userId)?.username || "User") : "Anonymous";

    await Messages.insertAsync({
      text,
      createdAt: new Date(),
      owner: userName,
      type: "user",
    });

    if (fileUploadInfo) {
      const documentId = new Mongo.ObjectID()._str;
      
      await Messages.insertAsync({
        text: `📄 Processing document "${fileUploadInfo.name}"...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });

      this.unblock(); 
      
      try {
        const fileBuffer = Buffer.from(fileUploadInfo.data, 'base64');
        const extractionResult = await extractTextFromFile(fileBuffer, fileUploadInfo.name, fileUploadInfo.type);
        
        if (!extractionResult.success) {
          await Messages.insertAsync({
            text: `❌ Error extracting text from document: ${extractionResult.text}`,
            createdAt: new Date(),
            userId: "system-error",
            owner: "Document Processor",
            type: "error",
          });
          return;
        }
        
        const documentRecord = {
          _id: documentId,
          title: fileUploadInfo.name,
          original_filename: fileUploadInfo.name,
          mime_type: fileUploadInfo.type,
          size_bytes: fileUploadInfo.size,
          uploaded_at: new Date(),
          text_content: extractionResult.text,
          text_extraction_method: extractionResult.method,
          metadata: extractionResult.metadata || {},
          user_context: text,
          processed: false,
        };
        
        await Meteor.callAsync('mcp.callMongoSdk', 'insert_document', {
          collection: 'documents',
          document: documentRecord
        });
        
        const textChunks = chunkText(
          extractionResult.text, 
          DOC_PROCESSING_CONFIG.CHUNK_SIZE, 
          DOC_PROCESSING_CONFIG.CHUNK_OVERLAP, 
          DOC_PROCESSING_CONFIG.MAX_CHUNKS
        );
        
        const chunksWithEmbeddings = await generateEmbeddingsForChunks(textChunks);
        
        const chunkRecords = chunksWithEmbeddings.map(chunk => ({
          document_id: documentId,
          chunk_index: chunk.index,
          text: chunk.text,
          char_count: chunk.charCount,
          embedding_vector: chunk.embedding,
          created_at: new Date()
        }));
        
        if (chunkRecords.length > 0) {
          await Meteor.callAsync('mcp.callMongoSdk', 'insert_document', {
            collection: 'document_chunks',
            document: chunkRecords
          });
        }
        
        const structuredData = await extractStructuredData(extractionResult.text, text);
        
        const esDocument = {
          title: fileUploadInfo.name,
          text_content: extractionResult.text,
          summary: extractionResult.text.substring(0, 300) + (extractionResult.text.length > 300 ? "..." : ""),
          document_id: documentId,
          original_filename: fileUploadInfo.name,
          mime_type: fileUploadInfo.type,
          size_bytes: fileUploadInfo.size,
          text_extraction_method: extractionResult.method,
          uploaded_at: new Date(),
          metadata: extractionResult.metadata || {},
          structured_data: structuredData,
          user_context: text,
          document_type: structuredData.detection.documentType || ["unknown"],
          text_length: extractionResult.text.length,
          chunk_count: chunkRecords.length,
        };
        
        if (chunksWithEmbeddings.length > 0 && chunksWithEmbeddings[0].embedding) {
          esDocument.embedding_vector = chunksWithEmbeddings[0].embedding;
        }
        
        await Meteor.callAsync('mcp.callElasticsearchSdk', 'index_document', {
          index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX,
          document_body: esDocument
        });
        
        for (const chunk of chunksWithEmbeddings) {
          if (chunk.embedding) {
            const chunkDoc = {
              document_id: documentId,
              chunk_index: chunk.index,
              text: chunk.text,
              title: fileUploadInfo.name,
              embedding_vector: chunk.embedding,
              char_count: chunk.charCount,
              document_type: structuredData.detection.documentType || ["unknown"],
              uploaded_at: new Date()
            };
            
            await Meteor.callAsync('mcp.callElasticsearchSdk', 'index_document', {
              index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX_CHUNKS,
              document_body: chunkDoc
            });
          }
        }
        
        await Meteor.callAsync('mcp.callMongoSdk', 'update_documents', {
          collection: 'documents',
          query: { _id: documentId },
          update: { 
            $set: { 
              processed: true,
              processed_at: new Date(),
              structured_data: structuredData,
              chunk_count: chunkRecords.length,
              document_type: structuredData.detection.documentType || ["unknown"],
            } 
          }
        });
        
        await Messages.insertAsync({
          text: `✅ Document "${fileUploadInfo.name}" successfully processed! ` +
                `Extracted ${extractionResult.text.length} characters and created ${chunkRecords.length} searchable chunks.`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "Document Processor",
          type: "system-info",
        });
        
        if (text && text.trim().length > 0) {
          const ozwellPrompt = `Document "${fileUploadInfo.name}" has been processed and stored. ` +
                               `Content length: ${extractionResult.text.length} characters. ` +
                               `User context: "${text}". Please provide helpful information about what the user can do with this document.`;
          
          try {
            const availableTools = await mcpSdkClient.getAvailableToolsForOzwell();
            const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(ozwellPrompt, availableTools);
            
            if (ozwellResponse.tool_calls && ozwellResponse.tool_calls.length > 0) {
              for (const toolCall of ozwellResponse.tool_calls) {
                const toolResult = await mcpSdkClient.executeToolCall(toolCall);
                
                await Messages.insertAsync({
                  text: `Tool Result: ${toolResult.content}`,
                  createdAt: new Date(),
                  userId: "system-mcp",
                  owner: "MCP Tool Result",
                  type: "mcp-response",
                });
              }
            }
            
            const aiText = ozwellResponse.answer || ozwellResponse.responseText || "Document processing complete.";
            await Messages.insertAsync({
              text: aiText,
              createdAt: new Date(),
              userId: "ozwell-ai",
              owner: "Ozwell AI",
              type: "ai",
            });
            
          } catch (error) {
            await Messages.insertAsync({
              text: `❌ Error: ${error.message}`,
              createdAt: new Date(),
              userId: "system-error",
              owner: "System",
              type: "error",
            });
          }
        }
        
      } catch (error) {
        await Messages.insertAsync({
          text: `❌ Error processing document "${fileUploadInfo.name}": ${error.message}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "Document Processor",
          type: "error",
        });
      }
      
      return;
    }

    // Handle regular text messages
    try {
      const availableTools = await mcpSdkClient.getAvailableToolsForOzwell();
      const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(text, availableTools);
      
      if (ozwellResponse.tool_calls && ozwellResponse.tool_calls.length > 0) {
        for (const toolCall of ozwellResponse.tool_calls) {
          await Messages.insertAsync({
            text: `🔧 Ozwell called tool: ${toolCall.function.name}`,
            createdAt: new Date(),
            userId: "system-auto",
            owner: "Ozwell Tool Call",
            type: "system-info",
          });
          
          try {
            const toolResult = await mcpSdkClient.executeToolCall(toolCall);
            
            let displayText;
            try {
              const resultObj = JSON.parse(toolResult.content);
              if (resultObj.success && resultObj.patients) {
                displayText = `👥 Found ${resultObj.patients.length} patients`;
                if (resultObj.patients.length > 0) {
                  displayText += `:\n`;
                  resultObj.patients.slice(0, 3).forEach((patient, index) => {
                    displayText += `\n${index + 1}. ${patient.name} (ID: ${patient.id})`;
                    if (patient.gender) displayText += ` - ${patient.gender}`;
                    if (patient.birthDate) displayText += ` - Born: ${patient.birthDate}`;
                  });
                }
              } else if (resultObj.success && resultObj.hits) {
                displayText = `🔍 Found ${resultObj.total || resultObj.hits.length} documents`;
                if (resultObj.hits.length > 0) {
                  displayText += `:\n`;
                  resultObj.hits.slice(0, 3).forEach((hit, index) => {
                    const source = hit._source || hit.source || {};
                    displayText += `\n${index + 1}. ${source.title || 'Untitled'}`;
                    if (hit._score) displayText += ` (relevance: ${hit._score.toFixed(2)})`;
                  });
                }
              } else if (resultObj.success && resultObj.documents) {
                displayText = `📄 Found ${resultObj.documents.length} documents in collection '${resultObj.collection}'`;
                if (resultObj.documents.length > 0) {
                  displayText += `:\n`;
                  resultObj.documents.slice(0, 3).forEach((doc, index) => {
                    displayText += `\n${index + 1}. ${doc.title || doc.original_filename || doc._id}`;
                    if (doc.uploaded_at) displayText += ` (${new Date(doc.uploaded_at).toLocaleDateString()})`;
                  });
                }
              } else {
                displayText = toolResult.content;
              }
            } catch (e) {
              displayText = toolResult.content;
            }
            
            await Messages.insertAsync({
              text: displayText,
              createdAt: new Date(),
              userId: "system-mcp",
              owner: "MCP Tool Result",
              type: "mcp-response",
            });
          } catch (toolError) {
            await Messages.insertAsync({
              text: `❌ Tool execution error: ${toolError.message}`,
              createdAt: new Date(),
              userId: "system-error",
              owner: "MCP Tool Error",
              type: "error",
            });
          }
        }
      }
      
      const aiText = ozwellResponse.answer || ozwellResponse.responseText || "Response received from Ozwell.";
      await Messages.insertAsync({
        text: aiText,
        createdAt: new Date(),
        userId: "ozwell-ai",
        owner: "Ozwell AI",
        type: "ai",
      });
      
      return ozwellResponse;
    } catch (error) {
      await Messages.insertAsync({
        text: `❌ Error communicating with Ozwell AI: ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "System",
        type: "error",
      });
      throw new Meteor.Error("api-error", `Failed to process message: ${error.message}`);
    }
  },

  // Direct MCP SDK server methods for manual testing
  async "mcp.callMongoSdk"(toolName, params) {
    check(toolName, String);
    check(params, Object);
    
    try {
      const result = await mcpSdkClient.callMongoDbMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `MongoDB Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "MongoDB MCP Server", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      await Messages.insertAsync({
        text: `❌ MongoDB Error: ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw new Meteor.Error("mcp-mongo-sdk-error", `MongoDB MCP SDK Server Error: ${error.message}`);
    }
  },

  async "mcp.callElasticsearchSdk"(toolName, params) {
    check(toolName, String);
    check(params, Object);

    try {
      const result = await mcpSdkClient.callElasticsearchMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `Elasticsearch Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "Elasticsearch MCP Server", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      await Messages.insertAsync({
        text: `❌ Elasticsearch Error: ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw new Meteor.Error("mcp-es-sdk-error", `Elasticsearch MCP SDK Server Error: ${error.message}`);
    }
  },

  async "mcp.callFhirSdk"(toolName, params) {
    check(toolName, String);
    check(params, Object);

    try {
      const result = await mcpSdkClient.callFhirMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `FHIR Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "FHIR MCP Server", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      await Messages.insertAsync({
        text: `❌ FHIR Error: ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw new Meteor.Error("mcp-fhir-sdk-error", `FHIR MCP SDK Server Error: ${error.message}`);
    }
  }
});