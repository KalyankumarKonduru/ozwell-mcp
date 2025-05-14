// Updated methods.js to implement the new document workflow
import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpOzwellClient } from "../mcp/client.js"; 
import { MongoInternals } from "meteor/mongo";

import * as mongoTools from "../server/integrations/mongodb/tools.js";
import * as esTools from "../server/integrations/elasticsearch/tools.js";
import { extractTextFromFile, chunkText, generateEmbeddingsForChunks, extractStructuredData } from "../mcp/document-processor.js";

// RAG Configuration
const RAG_CONFIG = {
  KEYWORDS: [
    // More flexible keywords
    "search documents for",
    "what does document x say about",
    "find info on",
    "according to my files",
    "in my records",
    "check my notes on",
    "using my documents",
    "look in my files",
    "based on my documents",
    "show me documents related to",
    "tell me about (.+?) from my documents",
    "what do my files say about",
    "search for",
    "find documents about"
  ],

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

function detectRagKeywords(text) {
  const lowerText = text.toLowerCase();
  return RAG_CONFIG.KEYWORDS.some(keyword => {

    return lowerText.includes(keyword.replace(" (.+?) ", " ").replace(" x ", " ")); // Basic normalization for matching
  });
}

function extractSearchQuery(text) {
  const lowerText = text.toLowerCase();
  let bestMatchKeyword = "";

  // Find the longest matching keyword to strip accurately
  for (const keyword of RAG_CONFIG.KEYWORDS) {
    const normalizedKeyword = keyword.replace(" (.+?) ", " ").replace(" x ", " ").toLowerCase();
    if (lowerText.startsWith(normalizedKeyword)) {
      if (normalizedKeyword.length > bestMatchKeyword.length) {
        bestMatchKeyword = normalizedKeyword;
      }
    }
  }

  if (bestMatchKeyword) {
    // Find the original keyword casing/structure for accurate length stripping
    const originalKeyword = RAG_CONFIG.KEYWORDS.find(k => k.toLowerCase().replace(" (.+?) ", " ").replace(" x ", " ") === bestMatchKeyword);
    if (originalKeyword) {

        let query = text.substring(originalKeyword.length).trim();

        if (originalKeyword.includes("from my documents")) {
            query = query.replace(/from my documents$/i, "").trim();
        }
         if (originalKeyword.includes("say about")) {

        }
        return query || text; // return original text if query becomes empty
    }
  }
  

  if (lowerText.includes("search for")) {
    return text.substring(lowerText.indexOf("search for") + "search for".length).trim();
  }
  if (lowerText.includes("find documents about")) {
    return text.substring(lowerText.indexOf("find documents about") + "find documents about".length).trim();
  }

  return text; 
}

// MongoDB Collections for storing documents and chunks
const Documents = new Mongo.Collection('documents');
const DocumentChunks = new Mongo.Collection('document_chunks');

// Create indexes if they don't exist
Meteor.startup(() => {
  if (Meteor.isServer) {
    Documents.createIndex({ "title": "text", "text_content": "text" });
    DocumentChunks.createIndex({ "document_id": 1 });
    DocumentChunks.createIndex({ "chunk_index": 1 });
    DocumentChunks.createIndex({ "text": "text" });
  }
});

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
        text: `Processing document "${fileUploadInfo.name}"...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "System",
        type: "processing",
      });


      this.unblock(); 
      

      try {
        // Step 1: Convert base64 to buffer
        const fileBuffer = Buffer.from(fileUploadInfo.data, 'base64');
        
        // Step 2: Extract text from the document
        await Messages.insertAsync({
          text: `Extracting text from "${fileUploadInfo.name}"...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
          type: "processing",
        });
        
        const extractionResult = await extractTextFromFile(fileBuffer, fileUploadInfo.name, fileUploadInfo.type);
        
        if (!extractionResult.success) {
          await Messages.insertAsync({
            text: `Error extracting text from document: ${extractionResult.text}`,
            createdAt: new Date(),
            userId: "system-error",
            owner: "System",
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
        
        // Step 4: Insert into MongoDB
        await Messages.insertAsync({
          text: `Storing document metadata and extracted text in MongoDB...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
          type: "processing",
        });
        
        await Documents.insertAsync(documentRecord);
        
        // Step 5: Chunk the document for better processing
        await Messages.insertAsync({
          text: `Analyzing document content and chunking for improved searchability...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
          type: "processing",
        });
        
        const textChunks = chunkText(
          extractionResult.text, 
          RAG_CONFIG.CHUNK_SIZE, 
          RAG_CONFIG.CHUNK_OVERLAP, 
          RAG_CONFIG.MAX_CHUNKS
        );
        
        // Step 6: Generate embeddings for the chunks
        await Messages.insertAsync({
          text: `Generating vector embeddings for semantic search capabilities...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
          type: "processing",
        });
        
        const chunksWithEmbeddings = await generateEmbeddingsForChunks(textChunks);
        
        // Step 7: Save chunks to MongoDB
        const chunkRecords = chunksWithEmbeddings.map(chunk => ({
          document_id: documentId,
          chunk_index: chunk.index,
          text: chunk.text,
          char_count: chunk.charCount,
          embedding_vector: chunk.embedding,
          created_at: new Date()
        }));
        
        // Insert all chunks
        if (chunkRecords.length > 0) {
          await DocumentChunks.rawCollection().insertMany(chunkRecords);
        }
        
        // Step 8: Extract structured data
        await Messages.insertAsync({
          text: `Analyzing document content for structured information...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
          type: "processing",
        });
        
        const structuredData = await extractStructuredData(extractionResult.text, text);
        
        // Step 9: Index document in Elasticsearch
        await Messages.insertAsync({
          text: `Indexing document in Elasticsearch for vector search...`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
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
        
        // Index in Elasticsearch
        const esIndexResult = await esTools.index_document({
          index: RAG_CONFIG.ELASTICSEARCH_INDEX,
          document_body: esDocument
        });
        
        // Step 10: Index chunks in Elasticsearch
        for (const chunk of chunksWithEmbeddings) {
          if (chunk.embedding) {
            await esTools.index_document({
              index: RAG_CONFIG.ELASTICSEARCH_INDEX_CHUNKS,
              document_body: {
                document_id: documentId,
                chunk_index: chunk.index,
                text: chunk.text,
                title: fileUploadInfo.name,
                embedding_vector: chunk.embedding,
                char_count: chunk.charCount,
                document_type: structuredData.detection.documentType || ["unknown"],
                uploaded_at: new Date()
              }
            });
          }
        }
        
        // Step 11: Update MongoDB document record to mark as processed
        await Documents.updateAsync({ _id: documentId }, { 
          $set: { 
            processed: true,
            processed_at: new Date(),
            structured_data: structuredData,
            chunk_count: chunkRecords.length,
            document_type: structuredData.detection.documentType || ["unknown"],
          } 
        });
        
        // Step 12: Final success message
        await Messages.insertAsync({
          text: `Document "${fileUploadInfo.name}" successfully processed and indexed. ` +
                `Extracted ${extractionResult.text.length} characters of text and created ${chunkRecords.length} searchable chunks. ` +
                `Document type detected: ${(structuredData.detection.documentType || ["unknown"]).join(", ")}.`,
          createdAt: new Date(),
          userId: "system-process",
          owner: "System",
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
3. Offer suggestions based on the document type (${(structuredData.detection.documentType || ["unknown"]).join(", ")})`;
          
          try {
            const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(ozwellPrompt);
            const aiText = ozwellResponse.answer || ozwellResponse.responseText || "Document processing complete.";
            
            await Messages.insertAsync({
              text: aiText,
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
          text: `Error processing document "${fileUploadInfo.name}": ${error.message}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "System",
          type: "error",
        });
      }
      
      return;
    }

    // Handle regular text messages (without file upload)
    const isRagQuery = detectRagKeywords(text);
    let ozwellPrompt = text;
    let ragContextAvailable = false;

    if (isRagQuery) {
      const searchQuery = extractSearchQuery(text);
      let searchResults = null;
      
      if (!searchQuery || searchQuery.toLowerCase() === text.toLowerCase()) {
        // If extraction didn't yield a more specific query, or if it's too broad,
        // maybe we shouldn't proceed or should ask for clarification.
        // For now, we proceed but log this.
        console.log("RAG triggered, but extracted search query is same as input or empty: ", searchQuery);
      }

      await Messages.insertAsync({
        text: `Searching documents for: "${searchQuery}"...`,
        createdAt: new Date(),
        userId: "system-rag",
        owner: "System",
        type: "system-info",
      });

      try {
        let esResponse;
        if (RAG_CONFIG.USE_VECTOR_SEARCH) {
          // First, we'll need to generate an embedding for the search query
          const { generateEmbedding } = await import("../mcp/embeddings.js");
          const queryEmbedding = await generateEmbedding(searchQuery);
          
          // First, try to match chunks for more precise results
          const chunkResponse = await esTools.vector_search_documents({
            index: RAG_CONFIG.ELASTICSEARCH_INDEX_CHUNKS,
            vector_field: RAG_CONFIG.VECTOR_FIELD,
            query_vector: queryEmbedding,
            k: RAG_CONFIG.MAX_SNIPPETS * 2, // Get more results to have variety
            _source: ["text", "document_id", "title", "chunk_index"],
          });
          
          // Get the document IDs from the chunks
          const documentIds = [...new Set(
            (chunkResponse?.hits?.hits || [])
              .map(hit => hit._source?.document_id)
              .filter(id => id)
          )];
          
          // If we found documents via chunks, get the full documents
          if (documentIds.length > 0) {
            esResponse = await esTools.search_documents({
              index: RAG_CONFIG.ELASTICSEARCH_INDEX,
              query_body: {
                query: {
                  terms: {
                    document_id: documentIds
                  }
                }
              },
              _source: RAG_CONFIG.ELASTICSEARCH_SOURCE_FIELDS,
              size: RAG_CONFIG.MAX_SNIPPETS,
            });
            
            // Augment the results with the matching chunks
            if (esResponse?.hits?.hits) {
              for (const doc of esResponse.hits.hits) {
                const docId = doc._source?.document_id;
                if (docId) {
                  // Find all chunks for this document
                  const matchingChunks = chunkResponse.hits.hits
                    .filter(chunk => chunk._source?.document_id === docId)
                    .map(chunk => ({
                      text: chunk._source?.text,
                      index: chunk._source?.chunk_index
                    }));
                  
                  if (matchingChunks.length > 0) {
                    doc._source.matching_chunks = matchingChunks;
                  }
                }
              }
            }
          } else {
            // Fallback to searching full documents
            esResponse = await esTools.vector_search_documents({
              index: RAG_CONFIG.ELASTICSEARCH_INDEX,
              vector_field: RAG_CONFIG.VECTOR_FIELD,
              query_vector: queryEmbedding,
              k: RAG_CONFIG.MAX_SNIPPETS,
              _source: RAG_CONFIG.ELASTICSEARCH_SOURCE_FIELDS,
            });
          }
        } else {
          // Traditional keyword search
          esResponse = await esTools.search_documents({
            index: RAG_CONFIG.ELASTICSEARCH_INDEX,
            query_body: {
              query: {
                multi_match: {
                  query: searchQuery,
                  fields: RAG_CONFIG.ELASTICSEARCH_SEARCH_FIELDS,
                  type: "best_fields",
                  fuzziness: "AUTO"
                },
              },
            },
            _source: RAG_CONFIG.ELASTICSEARCH_SOURCE_FIELDS,
            size: RAG_CONFIG.MAX_SNIPPETS,
          });
        }
        
        searchResults = esResponse?.hits?.hits || []; 

      } catch (integrationError) {
        console.error("Error calling integrated Elasticsearch tool for RAG:", integrationError);
        await Messages.insertAsync({
          text: `Error searching documents: ${integrationError.reason || integrationError.message}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "System",
          type: "error",
        });
      }

      if (searchResults && searchResults.length > 0) {
        let contextSnippets = "Retrieved context from your documents:\n\n";
        
        searchResults.slice(0, RAG_CONFIG.MAX_SNIPPETS).forEach((hit, index) => {
          const source = hit._source || {};
          let snippetText = `Document ${index + 1}: `;
          
          if (source.title) {
            snippetText += `"${source.title}"; `;
          }
          
          // If we have matching chunks, use those
          if (source.matching_chunks && source.matching_chunks.length > 0) {
            snippetText += `\nRelevant passages:\n`;
            
            source.matching_chunks.slice(0, 2).forEach((chunk, cIndex) => {
              snippetText += `Passage ${cIndex + 1}: ${chunk.text.substring(0, 300)}${chunk.text.length > 300 ? "..." : ""}\n`;
            });
          } else {
            // Otherwise use the full text or summary
            const content = source.text_content || source.summary || JSON.stringify(source).substring(0, 200) + "..."; 
            snippetText += `${content.substring(0, 500)}${content.length > 500 ? "..." : ""}\n`;
          }
          
          contextSnippets += snippetText + "\n";
        });
        
        ozwellPrompt = `User question: ${text}\n\n${contextSnippets}\n\nBased on the provided context from the documents, please answer the user's question. If the context doesn't contain enough information to fully answer the question, please state this clearly and answer based on what you can find in the provided context.`;
        ragContextAvailable = true;

        await Messages.insertAsync({
          text: `Found relevant information in your documents. Asking Ozwell for an answer...`,
          createdAt: new Date(),
          userId: "system-rag",
          owner: "System",
          type: "system-info",
        });

      } else {
        await Messages.insertAsync({
          text: `I couldn't find any specific information in your documents related to your query: "${searchQuery}"`,
          createdAt: new Date(),
          userId: "system-rag",
          owner: "System",
          type: "system-info",
        });
        
        // Continue with regular processing but inform the LLM that no documents were found
        ozwellPrompt = `User asked: ${text}\n\nI searched for documents related to "${searchQuery}" but couldn't find any relevant information in the user's document store. Please respond to the user's query based on your general knowledge, and mention that no matching documents were found.`;
      }
    }

    if (!isRagQuery || (isRagQuery && ragContextAvailable)) {
      try {
        const ozwellResponse = await mcpOzwellClient.sendMessageToOzwell(ozwellPrompt);
        const aiText = ozwellResponse.answer || ozwellResponse.responseText || "Ozwell LLM response received.";

        await Messages.insertAsync({
          text: aiText,
          createdAt: new Date(),
          userId: "ozwell-ai",
          owner: "Ozwell AI",
          type: "ai",
        });

        if (ozwellResponse.mcp_instructions && !isRagQuery) {
          const instruction = ozwellResponse.mcp_instructions;
          let mcpResultText = "";
          try {
            let result;
            if (instruction.target === "mongodb" && instruction.tool && instruction.params) {
              if (mongoTools[instruction.tool]) {
                result = await mongoTools[instruction.tool](instruction.params);
                mcpResultText = `MongoDB Integrated Tool (${instruction.tool}) Result: ${JSON.stringify(result, null, 2)}`;
              } else {
                throw new Meteor.Error("method-not-found", `MongoDB integrated tool "${instruction.tool}" not found.`);
              }
            } else if (instruction.target === "elasticsearch" && instruction.tool && instruction.params) {
              if (esTools[instruction.tool]) {
                result = await esTools[instruction.tool](instruction.params);
                mcpResultText = `Elasticsearch Integrated Tool (${instruction.tool}) Result: ${JSON.stringify(result, null, 2)}`;
              } else {
                throw new Meteor.Error("method-not-found", `Elasticsearch integrated tool "${instruction.tool}" not found.`);
              }
            }
            if (mcpResultText) {
              await Messages.insertAsync({
                text: mcpResultText,
                createdAt: new Date(),
                userId: "system-mcp",
                owner: "MCP System",
                type: "mcp-response",
              });
            }
          } catch (mcpError) {
            await Messages.insertAsync({
              text: `Error during integrated MCP call (${instruction.target} - ${instruction.tool}): ${mcpError.reason || mcpError.message}`,
              createdAt: new Date(),
              userId: "system-error",
              owner: "System",
              type: "error",
            });
          }
        }
        return ozwellResponse;
      } catch (error) {
        await Messages.insertAsync({
          text: `Error communicating with AI: ${error.message}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "System",
          type: "error",
        });
        throw new Meteor.Error("api-error", `Failed to process message: ${error.message}`);
      }
    }
  },

  async "mcp.callMongo"(toolName, params) {
    check(toolName, String);
    check(params, Object);
    
    console.log(`Calling integrated MongoDB tool: ${toolName}`, params);
    try {
      if (mongoTools[toolName]) {
        const result = await mongoTools[toolName](params);
        await Messages.insertAsync({
          text: `MongoDB Integrated Tool (${toolName}) Result: ${JSON.stringify(result, null, 2)}`,
          createdAt: new Date(), userId: "system-mcp", owner: "MongoDB (Integrated)", type: "mcp-response"
        });
        return result;
      } else {
        throw new Meteor.Error("method-not-found", `MongoDB integrated tool "${toolName}" not found.`);
      }
    } catch (error) {
      await Messages.insertAsync({
        text: `Error calling integrated MongoDB tool (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), userId: "system-error", owner: "System", type: "error"
      });
      if (error instanceof Meteor.Error) throw error;
      throw new Meteor.Error("mcp-mongo-error-integrated", `Integrated MongoDB Tool Error: ${error.message}`);
    }
  },

  async "mcp.callElasticsearch"(toolName, params) {
    check(toolName, String);
    check(params, Object);

    console.log(`Calling integrated Elasticsearch tool: ${toolName}`, params);
    try {
      if (esTools[toolName]) {
        const result = await esTools[toolName](params);
        await Messages.insertAsync({
          text: `Elasticsearch Integrated Tool (${toolName}) Result: ${JSON.stringify(result, null, 2)}`,
          createdAt: new Date(), userId: "system-mcp", owner: "Elasticsearch (Integrated)", type: "mcp-response"
        });
        return result;
      } else {
        throw new Meteor.Error("method-not-found", `Elasticsearch integrated tool "${toolName}" not found.`);
      }
    } catch (error) {
      await Messages.insertAsync({
        text: `Error calling integrated Elasticsearch tool (${toolName}): ${error.reason || error.message}`,
        createdAt: new Date(), userId: "system-error", owner: "System", type: "error"
      });
      if (error instanceof Meteor.Error) throw error;
      throw new Meteor.Error("mcp-es-error-integrated", `Integrated Elasticsearch Tool Error: ${error.message}`);
    }
  }
});