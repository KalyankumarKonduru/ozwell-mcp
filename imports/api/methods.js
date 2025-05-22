// imports/api/methods.js - CLEANED VERSION (External MCP Only)

import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpOzwellClient, createToolAwareSystemPrompt, executeToolsFromResponse, cleanResponseText, mcpExternalClient } from "../mcp/client.js"; 
import { extractTextFromFile, chunkText, generateEmbeddingsForChunks, extractStructuredData } from "../mcp/document-processor.js";

// Document processing config
const DOC_PROCESSING_CONFIG = {
  ELASTICSEARCH_INDEX: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX || "ozwell_documents",
  ELASTICSEARCH_INDEX_CHUNKS: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX_CHUNKS || "ozwell_document_chunks",
  ELASTICSEARCH_SEARCH_FIELDS: Meteor.settings.private?.RAG_ELASTICSEARCH_SEARCH_FIELDS || ["title", "text_content", "summary"],
  ELASTICSEARCH_SOURCE_FIELDS: Meteor.settings.private?.RAG_ELASTICSEARCH_SOURCE_FIELDS || ["title", "text_content"],
  MAX_SNIPPETS: Meteor.settings.private?.RAG_MAX_SNIPPETS || 3,
  VECTOR_FIELD: Meteor.settings.private?.RAG_VECTOR_FIELD || "embedding_vector",
  USE_VECTOR_SEARCH: Meteor.settings.private?.RAG_USE_VECTOR_SEARCH || false,
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

    // First, insert the user's message
    await Messages.insertAsync({
      text,
      createdAt: new Date(),
      owner: userName,
      type: "user",
    });

    // If a file was uploaded, process it
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
        // Step 1: Convert base64 to buffer
        const fileBuffer = Buffer.from(fileUploadInfo.data, 'base64');
        
        // Step 2: Extract text from the document
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
            text: `❌ Error extracting text from document: ${extractionResult.text}`,
            createdAt: new Date(),
            userId: "system-error",
            owner: "Document Processor",
            type: "error",
          });
          return;
        }
        
        // Step 3: Create document record for MongoDB
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
        
        // Step 4: Insert into MongoDB via external MCP server
        await Messages.insertAsync({
          text: `💾 Storing document metadata in MongoDB Atlas via MCP server...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "Document Processor",
          type: "processing",
        });
        
        await Meteor.callAsync('mcp.callMongoExternal', 'insert_document', {
          collection: 'documents',
          document: documentRecord
        });
        
        // Step 5: Chunk the document for better processing
        await Messages.insertAsync({
          text: `✂️ Analyzing document content and chunking for improved searchability...`,
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
        
        // Step 6: Generate embeddings for the chunks
        await Messages.insertAsync({
          text: `🧠 Generating vector embeddings for semantic search capabilities...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "Document Processor",
          type: "processing",
        });
        
        const chunksWithEmbeddings = await generateEmbeddingsForChunks(textChunks);
        
        // Step 7: Save chunks to MongoDB via external MCP server
        const chunkRecords = chunksWithEmbeddings.map(chunk => ({
          document_id: documentId,
          chunk_index: chunk.index,
          text: chunk.text,
          char_count: chunk.charCount,
          embedding_vector: chunk.embedding,
          created_at: new Date()
        }));
        
        // Insert all chunks via external MCP server
        if (chunkRecords.length > 0) {
          await Meteor.callAsync('mcp.callMongoExternal', 'insert_document', {
            collection: 'document_chunks',
            document: chunkRecords
          });
        }
        
        // Step 8: Extract structured data
        await Messages.insertAsync({
          text: `🔬 Analyzing document content for structured information...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "Document Processor",
          type: "processing",
        });
        
        const structuredData = await extractStructuredData(extractionResult.text, text);
        
        // Step 9: Index document in Elasticsearch via external MCP server
        await Messages.insertAsync({
          text: `🔗 Indexing document in Elasticsearch Cloud via MCP server...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "Document Processor",
          type: "processing",
        });
        
        // Create Elasticsearch document
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
        
        // Get the first chunk's embedding for the main document embedding
        if (chunksWithEmbeddings.length > 0 && chunksWithEmbeddings[0].embedding) {
          esDocument.embedding_vector = chunksWithEmbeddings[0].embedding;
        }
        
        // Index in Elasticsearch via external MCP server
        await Meteor.callAsync('mcp.callElasticsearchExternal', 'index_document', {
          index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX,
          document_body: esDocument
        });
        
        // Step 10: Index chunks in Elasticsearch via external MCP server
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
            
            await Meteor.callAsync('mcp.callElasticsearchExternal', 'index_document', {
              index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX_CHUNKS,
              document_body: chunkDoc
            });
          }
        }
        
        // Step 11: Update MongoDB document record to mark as processed
        await Meteor.callAsync('mcp.callMongoExternal', 'update_documents', {
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
        
        // Step 12: Final success message
        await Messages.insertAsync({
          text: `✅ Document "${fileUploadInfo.name}" successfully processed via external MCP servers! ` +
                `Extracted ${extractionResult.text.length} characters of text and created ${chunkRecords.length} searchable chunks. ` +
                `Document type detected: ${(structuredData.detection.documentType || ["unknown"]).join(", ")}.`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "Document Processor",
          type: "system-info",
        });
        
        // Ask Ozwell to analyze the document if we have contextual information
        if (text && text.trim().length > 0) {
          const ozwellPrompt = `The user has uploaded a document "${fileUploadInfo.name}" and provided this context: "${text}". 
          
Document details: 
- Content length: ${extractionResult.text.length} characters
- Document type: ${(structuredData.detection.documentType || ["unknown"]).join(", ")}
${structuredData.extractedFields && Object.keys(structuredData.extractedFields).length > 0 
  ? `- Extracted fields: ${JSON.stringify(structuredData.extractedFields, null, 2)}` 
  : ''}

Based on this information, please:
1. Confirm the document has been successfully processed and stored
2. Explain what the user can do with this document now (e.g., search for information in it)
3. Offer suggestions based on the document type (${(structuredData.detection.documentType || ["unknown"]).join(", ")})

The system uses external MCP servers for all database operations.`;
          
          try {
            // Add system prompt for tool awareness
            const enhancedPrompt = `${ozwellPrompt}\n\n${createToolAwareSystemPrompt()}`;
            
            const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(enhancedPrompt);
            const aiText = ozwellResponse.answer || ozwellResponse.responseText || "Document processing complete.";
            
            // Clean the response text to remove any JSON code blocks
            const cleanedText = cleanResponseText(aiText);
            
            // Display Ozwell's response to the user
            await Messages.insertAsync({
              text: cleanedText,
              createdAt: new Date(),
              userId: "ozwell-ai",
              owner: "Ozwell AI",
              type: "ai",
            });
            
            // Execute tools based on Ozwell's response using external MCP servers
            console.log("Attempting to execute tools from Ozwell response via external MCP servers");
            await executeToolsFromResponse(ozwellResponse);
          } catch (error) {
            console.error("Error communicating with AI or executing external MCP tools:", error);
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
        console.error("Document processing error:", error);
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

    // Handle regular text messages (without file upload)
    try {
      // Enhance the prompt with tool instructions for external MCP servers
      const enhancedPrompt = `${text}\n\n${createToolAwareSystemPrompt()}`;
      
      // Send enhanced prompt to Ozwell
      const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(enhancedPrompt);
      
      // Get the AI's text response and clean it
      const aiText = ozwellResponse.answer || ozwellResponse.responseText || "Ozwell LLM response received.";
      const cleanedText = cleanResponseText(aiText);
      
      // Display the cleaned response to the user
      await Messages.insertAsync({
        text: cleanedText,
        createdAt: new Date(),
        userId: "ozwell-ai",
        owner: "Ozwell AI",
        type: "ai",
      });
      
      // Attempt to execute tools from Ozwell's response using external MCP servers
      console.log("Attempting to execute tools from Ozwell response via external MCP servers");
      await executeToolsFromResponse(ozwellResponse);
      
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

  // External MCP server methods only
  async "mcp.callMongoExternal"(toolName, params) {
    check(toolName, String);
    check(params, Object);
    
    console.log(`📡 Calling external MongoDB MCP server tool: ${toolName}`, params);
    try {
      const result = await mcpExternalClient.callMongoDbMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `MongoDB MCP Server (${toolName}) Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "MongoDB MCP Server", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      console.error(`❌ Error calling external MongoDB MCP server (${toolName}):`, error);
      
      await Messages.insertAsync({
        text: `❌ Error calling external MongoDB MCP server (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw new Meteor.Error("mcp-mongo-external-error", `External MongoDB MCP Server Error: ${error.message}`);
    }
  },

  async "mcp.callElasticsearchExternal"(toolName, params) {
    check(toolName, String);
    check(params, Object);

    console.log(`📡 Calling external Elasticsearch MCP server tool: ${toolName}`, params);
    try {
      const result = await mcpExternalClient.callElasticsearchMcp(toolName, params);
      
      await Messages.insertAsync({
        text: `Elasticsearch MCP Server (${toolName}) Result: ${JSON.stringify(result, null, 2)}`,
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "Elasticsearch MCP Server", 
        type: "mcp-response"
      });
      
      return result;
    } catch (error) {
      console.error(`❌ Error calling external Elasticsearch MCP server (${toolName}):`, error);
      
      await Messages.insertAsync({
        text: `❌ Error calling external Elasticsearch MCP server (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw new Meteor.Error("mcp-es-external-error", `External Elasticsearch MCP Server Error: ${error.message}`);
    }
  },

  // Health check methods for external MCP servers
  async "mcp.checkExternalHealth"() {
    const results = {
      mongodb: await mcpExternalClient.checkMongoDbMcpHealth(),
      elasticsearch: await mcpExternalClient.checkElasticsearchMcpHealth()
    };

    // Display health check results
    await Messages.insertAsync({
      text: `🏥 External MCP Server Health Check:\n` +
            `MongoDB: ${results.mongodb.status}\n` +
            `Elasticsearch: ${results.elasticsearch.status}`,
      createdAt: new Date(),
      userId: "system-health",
      owner: "MCP Health Check",
      type: "system-info",
    });

    return results;
  },
  
  // Test method for external MCP server search
  async "mcp.testExternalSearch"(searchTerm) {
    check(searchTerm, String);
    console.log(`Testing external MCP search for: ${searchTerm}`);
    
    try {
      await Messages.insertAsync({
        text: `🔍 Testing external MCP search for: "${searchTerm}"`,
        createdAt: new Date(),
        userId: "system-test",
        owner: "MCP Test",
        type: "system-info",
      });
      
      const result = await mcpExternalClient.callElasticsearchMcp('search_documents', {
        index: DOC_PROCESSING_CONFIG.ELASTICSEARCH_INDEX,
        query_body: {
          query: {
            match: {
              text_content: searchTerm
            }
          }
        }
      });
      
      if (result && result.hits && result.hits.length > 0) {
        const hits = result.hits;
        
        await Messages.insertAsync({
          text: `✅ External MCP found ${hits.length} results for "${searchTerm}"`,
          createdAt: new Date(),
          userId: "system-elasticsearch",
          owner: "Elasticsearch MCP",
          type: "system-info",
        });
        
        // Display each hit (up to 3)
        for (let i = 0; i < Math.min(hits.length, 3); i++) {
          const hit = hits[i];
          const source = hit._source || hit.source || {};
          
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
            userId: "system-elasticsearch",
            owner: "Elasticsearch MCP Server",
            type: "mcp-response",
          });
        }
      } else {
        await Messages.insertAsync({
          text: `ℹ️ No results found for "${searchTerm}" via external MCP server`,
          createdAt: new Date(),
          userId: "system-elasticsearch",
          owner: "Elasticsearch MCP",
          type: "system-info",
        });
      }
      
      return { success: true, resultsFound: result?.hits?.length || 0 };
    } catch (error) {
      console.error("Error testing external MCP search:", error);
      await Messages.insertAsync({
        text: `❌ Error testing external MCP search: ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "MCP Test",
        type: "error",
      });
      throw error;
    }
  }
});