// imports/api/methods.js - Clean implementation without tool prompting

import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpOzwellClient, mcpSdkClient } from "../mcp/client.js"; 
import { extractTextFromFile, chunkText, generateEmbeddingsForChunks, extractStructuredData } from "../mcp/document-processor.js";

// Document processing config
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

    // Insert the user's message
    await Messages.insertAsync({
      text,
      createdAt: new Date(),
      owner: userName,
      type: "user",
    });

    // Handle file upload if present
    if (fileUploadInfo) {
      await this.processFileUpload(fileUploadInfo, text);
      return;
    }

    // Handle regular text messages - just send to Ozwell directly
    try {
      const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(text);
      
      await Messages.insertAsync({
        text: ozwellResponse.responseText || ozwellResponse.answer,
        createdAt: new Date(),
        userId: "ozwell-ai",
        owner: "Ozwell AI",
        type: "ai",
      });
      
      return ozwellResponse;
    } catch (error) {
      await Messages.insertAsync({
        text: `❌ Error communicating with AI: ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "System",
        type: "error",
      });
      throw new Meteor.Error("api-error", `Failed to process message: ${error.message}`);
    }
  },

  async processFileUpload(fileUploadInfo, userContext) {
    const documentId = new Mongo.ObjectID()._str;
    
    await Messages.insertAsync({
      text: `📄 Processing document "${fileUploadInfo.name}"...`,
      createdAt: new Date(),
      userId: "system-process",
      owner: "Document Processor",
      type: "processing",
    });

    try {
      // Extract text from the document
      const fileBuffer = Buffer.from(fileUploadInfo.data, 'base64');
      
      await Messages.insertAsync({
        text: `🔍 Extracting text from "${fileUploadInfo.name}"...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });
      
      const extractionResult = await extractTextFromFile(fileBuffer, fileUploadInfo.name, fileUploadInfo.type);
      
      if (!extractionResult.success) {
        await Messages.insertAsync({
          text: `❌ Error extracting text: ${extractionResult.text}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "Document Processor",
          type: "error",
        });
        return;
      }
      
      // Create document record
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
        user_context: userContext,
        processed: false,
      };
      
      // Store in MongoDB
      await Messages.insertAsync({
        text: `💾 Storing document in MongoDB...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });
      
      await Meteor.callAsync('mcp.callMongoHttp', 'insert_document', {
        collection: 'documents',
        document: documentRecord
      });
      
      // Create chunks for better searchability
      await Messages.insertAsync({
        text: `✂️ Creating searchable chunks...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });
      
      const textChunks = chunkText(
        extractionResult.text, 
        DOC_PROCESSING_CONFIG.CHUNK_SIZE, 
        DOC_PROCESSING_CONFIG.CHUNK_OVERLAP, 
        DOC_PROCESSING_CONFIG.MAX_CHUNKS
      );
      
      // Generate embeddings
      await Messages.insertAsync({
        text: `🧠 Generating embeddings for search...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });
      
      const chunksWithEmbeddings = await generateEmbeddingsForChunks(textChunks);
      
      // Store chunks
      const chunkRecords = chunksWithEmbeddings.map(chunk => ({
        document_id: documentId,
        chunk_index: chunk.index,
        text: chunk.text,
        char_count: chunk.charCount,
        embedding_vector: chunk.embedding,
        created_at: new Date()
      }));
      
      if (chunkRecords.length > 0) {
        await Meteor.callAsync('mcp.callMongoHttp', 'insert_document', {
          collection: 'document_chunks',
          document: chunkRecords
        });
      }
      
      // Extract structured data
      const structuredData = await extractStructuredData(extractionResult.text, userContext);
      
      // Index in Elasticsearch
      await Messages.insertAsync({
        text: `🔗 Indexing in Elasticsearch...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });
      
      const esDocument = {
        title: fileUploadInfo.name,
        text_content: extractionResult.text,
        summary: extractionResult.text.substring(0, 300) + (extractionResult.text.length > 300 ? "..." : ""),
        document_id: documentId,
        original_filename: fileUploadInfo.name,
        mime_type: fileUploadInfo.type,
        size_bytes: fileUploadInfo.size,
        uploaded_at: new Date(),
        metadata: extractionResult.metadata || {},
        structured_data: structuredData,
        user_context: userContext,
        document_type: structuredData.detection?.documentType || ["unknown"],
        text_length: extractionResult.text.length,
        chunk_count: chunkRecords.length,
      };
      
      // Add embedding from first chunk
      if (chunksWithEmbeddings.length > 0 && chunksWithEmbeddings[0].embedding) {
        esDocument.embedding_vector = chunksWithEmbeddings[0].embedding;
      }
      
      await Meteor.callAsync('mcp.callElasticsearchHttp', 'index_document', {
        index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX,
        document_body: esDocument
      });
      
      // Index chunks
      for (const chunk of chunksWithEmbeddings) {
        if (chunk.embedding) {
          const chunkDoc = {
            document_id: documentId,
            chunk_index: chunk.index,
            text: chunk.text,
            title: fileUploadInfo.name,
            embedding_vector: chunk.embedding,
            char_count: chunk.charCount,
            uploaded_at: new Date()
          };
          
          await Meteor.callAsync('mcp.callElasticsearchHttp', 'index_document', {
            index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX_CHUNKS,
            document_body: chunkDoc
          });
        }
      }
      
      // Mark as processed
      await Meteor.callAsync('mcp.callMongoHttp', 'update_documents', {
        collection: 'documents',
        query: { _id: documentId },
        update: { 
          $set: { 
            processed: true,
            processed_at: new Date(),
            structured_data: structuredData,
            chunk_count: chunkRecords.length
          } 
        }
      });
      
      // Success message
      await Messages.insertAsync({
        text: `✅ Document "${fileUploadInfo.name}" successfully processed! ` +
              `Extracted ${extractionResult.text.length} characters and created ${chunkRecords.length} searchable chunks.`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "system-info",
      });
      
      // Let Ozwell analyze the document if context provided
      if (userContext && userContext.trim().length > 0) {
        const analysisPrompt = `I've uploaded a document "${fileUploadInfo.name}" with this context: "${userContext}". The document has been processed and contains ${extractionResult.text.length} characters. What can you tell me about this document?`;
        
        try {
          const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(analysisPrompt);
          
          await Messages.insertAsync({
            text: ozwellResponse.responseText || ozwellResponse.answer,
            createdAt: new Date(),
            userId: "ozwell-ai",
            owner: "Ozwell AI",
            type: "ai",
          });
        } catch (error) {
          console.error("Error getting Ozwell analysis:", error);
        }
      }
      
    } catch (error) {
      console.error("Document processing error:", error);
      await Messages.insertAsync({
        text: `❌ Error processing document "${fileUploadInfo.name}": ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "Document Processor",
        type: "error",
      });
    }
  },

  // HTTP MCP server methods
  async "mcp.callMongoHttp"(toolName, params) {
    check(toolName, String);
    check(params, Object);
    
    try {
      const result = await mcpSdkClient.callMongoDbMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `MongoDB Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "MongoDB MCP", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      console.error(`❌ Error calling MongoDB MCP (${toolName}):`, error);
      
      await Messages.insertAsync({
        text: `❌ Error calling MongoDB MCP (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw error;
    }
  },

  async "mcp.callElasticsearchHttp"(toolName, params) {
    check(toolName, String);
    check(params, Object);

    try {
      const result = await mcpSdkClient.callElasticsearchMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `Elasticsearch Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "Elasticsearch MCP", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      console.error(`❌ Error calling Elasticsearch MCP (${toolName}):`, error);
      
      await Messages.insertAsync({
        text: `❌ Error calling Elasticsearch MCP (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw error;
    }
  },

  async "mcp.callFhirHttp"(toolName, params) {
    check(toolName, String);
    check(params, Object);

    try {
      const result = await mcpSdkClient.callFhirMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `FHIR Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "FHIR MCP", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      console.error(`❌ Error calling FHIR MCP (${toolName}):`, error);
      
      await Messages.insertAsync({
        text: `❌ Error calling FHIR MCP (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw error;
    }
  },

  // Test method for searching documents
  async "mcp.testSearch"(searchTerm) {
    check(searchTerm, String);
    console.log(`Testing search for: ${searchTerm}`);
    
    try {
      await Messages.insertAsync({
        text: `🔍 Testing search for: "${searchTerm}"`,
        createdAt: new Date(),
        userId: "system-test",
        owner: "Search Test",
        type: "system-info",
      });
      
      const result = await mcpSdkClient.callElasticsearchMcp('search_documents', {
        index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX,
        query_body: {
          query: {
            multi_match: {
              query: searchTerm,
              fields: ['title', 'text_content', 'summary']
            }
          }
        },
        size: 5
      });
      
      if (result && result.hits && result.hits.length > 0) {
        await Messages.insertAsync({
          text: `✅ Found ${result.hits.length} results for "${searchTerm}"`,
          createdAt: new Date(),
          userId: "system-search",
          owner: "Search Test",
          type: "system-info",
        });
        
        // Display results
        for (let i = 0; i < Math.min(result.hits.length, 3); i++) {
          const hit = result.hits[i];
          const source = hit._source || {};
          
          let content = `📄 Result ${i+1}:\n`;
          if (source.title) content += `Title: ${source.title}\n`;
          if (source.text_content) {
            const snippet = source.text_content.substring(0, 300) + 
              (source.text_content.length > 300 ? "..." : "");
            content += `Content: ${snippet}`;
          }
          
          await Messages.insertAsync({
            text: content,
            createdAt: new Date(),
            userId: "system-search",
            owner: "Search Result",
            type: "mcp-response",
          });
        }
      } else {
        await Messages.insertAsync({
          text: `ℹ️ No results found for "${searchTerm}"`,
          createdAt: new Date(),
          userId: "system-search",
          owner: "Search Test",
          type: "system-info",
        });
      }
      
      return { success: true, resultsFound: result?.hits?.length || 0 };
    } catch (error) {
      console.error("Error testing search:", error);
      await Messages.insertAsync({
        text: `❌ Error testing search: ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "Search Test",
        type: "error",
      });
      throw error;
    }
  }
});