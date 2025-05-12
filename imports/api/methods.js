import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpOzwellClient } from "../mcp/client.js"; 
import { MongoInternals } from "meteor/mongo";

import * as mongoTools from "../server/integrations/mongodb/tools.js";
import * as esTools from "../server/integrations/elasticsearch/tools.js";

const RAG_CONFIG = {
  KEYWORDS: [
    // More flexible keywords
    "search documents for",
    "what does document x say about", // X will be part of the query
    "find info on",
    "according to my files",
    "in my records",
    "check my notes on",
    "using my documents",
    "look in my files",
    "based on my documents",
    "show me documents related to",
    "tell me about (.+?) from my documents", // Regex-like, but we'll use simple includes
    "what do my files say about",
    "search for", // General search trigger
    "find documents about"
  ],
  // More specific patterns for extraction might be needed if simple keyword removal isn't enough
  // For now, extractSearchQuery will try to strip these known prefixes.
  ELASTICSEARCH_INDEX: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX || "ozwell_documents",
  ELASTICSEARCH_SEARCH_FIELDS: Meteor.settings.private?.RAG_ELASTICSEARCH_SEARCH_FIELDS || ["title", "text_content", "summary"],
  ELASTICSEARCH_SOURCE_FIELDS: Meteor.settings.private?.RAG_ELASTICSEARCH_SOURCE_FIELDS || ["title", "text_content"],
  MAX_SNIPPETS: Meteor.settings.private?.RAG_MAX_SNIPPETS || 3,
  VECTOR_FIELD: Meteor.settings.private?.RAG_VECTOR_FIELD || "embedding_vector",
  USE_VECTOR_SEARCH: Meteor.settings.private?.RAG_USE_VECTOR_SEARCH || false,
};

function detectRagKeywords(text) {
  const lowerText = text.toLowerCase();
  return RAG_CONFIG.KEYWORDS.some(keyword => {
    // For keywords that might be part of a phrase, simple includes is fine
    // For keywords like "what does document x say about", we need to ensure it's a trigger
    // This simple check might need refinement for more complex keyword patterns
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
        // A more careful stripping, assuming keyword is at the start
        // This might need to be smarter if keywords can be mid-sentence for query extraction
        let query = text.substring(originalKeyword.length).trim();
        // Remove common trailing phrases if keyword was like "tell me about X from my documents"
        if (originalKeyword.includes("from my documents")) {
            query = query.replace(/from my documents$/i, "").trim();
        }
         if (originalKeyword.includes("say about")) {
            // e.g. "what do my files say about X" -> X
            // This is tricky, for now, we assume the keyword was a prefix.
        }
        return query || text; // return original text if query becomes empty
    }
  }
  
  // Fallback if no prefix keyword matched, or for more general search terms
  // This part might need more sophisticated NLP if the query isn't just after a keyword
  if (lowerText.includes("search for")) {
    return text.substring(lowerText.indexOf("search for") + "search for".length).trim();
  }
  if (lowerText.includes("find documents about")) {
    return text.substring(lowerText.indexOf("find documents about") + "find documents about".length).trim();
  }

  return text; // Default to full text if no specific extraction rule applies
}

Meteor.methods({
  async "messages.send"(text) {
    const userName = this.userId ? (Meteor.users.findOne(this.userId)?.username || "User") : "Anonymous";

    await Messages.insertAsync({
      text,
      createdAt: new Date(),
      owner: userName,
      type: "user",
    });

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
        text: `(RAG) Searching documents for: "${searchQuery}"...`,
        createdAt: new Date(),
        userId: "system-rag",
        owner: "System",
        type: "system-info",
      });

      try {
        let esResponse;
        if (RAG_CONFIG.USE_VECTOR_SEARCH) {
            console.warn("Vector search triggered, but query_vector generation is a placeholder.");
            esResponse = await esTools.vector_search_documents({
                index: RAG_CONFIG.ELASTICSEARCH_INDEX,
                vector_field: RAG_CONFIG.VECTOR_FIELD,
                query_vector: searchQuery, 
                k: RAG_CONFIG.MAX_SNIPPETS,
                _source: RAG_CONFIG.ELASTICSEARCH_SOURCE_FIELDS,
            });
        } else {
            esResponse = await esTools.search_documents({
                index: RAG_CONFIG.ELASTICSEARCH_INDEX,
                query_body: {
                    query: {
                        multi_match: {
                            query: searchQuery,
                            fields: RAG_CONFIG.ELASTICSEARCH_SEARCH_FIELDS,
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
        let contextSnippets = "Retrieved context from your documents:\n";
        searchResults.slice(0, RAG_CONFIG.MAX_SNIPPETS).forEach((hit, index) => {
          const source = hit._source || {};
          let snippetText = `Snippet ${index + 1}: `;
          if (source.title) snippetText += `Title: ${source.title}; `;
          const content = source.text_content || JSON.stringify(source).substring(0, 200) + "..."; 
          snippetText += `${content.substring(0, 300)}...\n`;
          contextSnippets += snippetText;
        });
        
        ozwellPrompt = `User question: ${text}\n\n${contextSnippets}\nBased on the provided context from the documents, please answer the user\"s question.`;
        ragContextAvailable = true;

        await Messages.insertAsync({
          text: "Found relevant information in your documents. Asking Ozwell...",
          createdAt: new Date(),
          userId: "system-rag",
          owner: "System",
          type: "system-info",
        });

      } else {
        await Messages.insertAsync({
          text: "I couldn\"t find any specific information in your documents related to your query: \"" + searchQuery + "\"",
          createdAt: new Date(),
          userId: "system-rag",
          owner: "System",
          type: "ai",
        });
        return; 
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
  },

  async "documents.uploadAndProcess"(fileInfo) { 
    check(fileInfo, { name: String, type: String, size: Number, data: String }); 
    console.log("Received request to process document.");
    
    const docToStore = {
      title: fileInfo.name,
      text_content: `Placeholder: Content of ${fileInfo.name}. Type: ${fileInfo.type}. Size: ${fileInfo.size} bytes. Base64 data starts with: ${fileInfo.data.substring(0,30)}... Actual text extraction from base64 data and complex file types (PDF, DOCX) needs to be implemented here. For now, only this placeholder text will be indexed.`,
      original_filename: fileInfo.name,
      mime_type: fileInfo.type,
      size_bytes: fileInfo.size,
      uploaded_at: new Date(),
    };

    try {
      // For actual text extraction from base64, you'd do something like:
      // let actualTextContent = "Error extracting text";
      // if (fileInfo.type === "text/plain") {
      //   actualTextContent = Buffer.from(fileInfo.data, 'base64').toString('utf8');
      // } else if (fileInfo.type === "application/pdf") {
      //   // Use a library like pdf-parse (needs to be installed and imported)
      //   // const pdf = require('pdf-parse');
      //   // const pdfData = await pdf(Buffer.from(fileInfo.data, 'base64'));
      //   // actualTextContent = pdfData.text;
      //   actualTextContent = "PDF text extraction placeholder - requires pdf-parse or similar.";
      // } else {
      //   actualTextContent = "Unsupported file type for direct text extraction in this placeholder.";
      // }
      // docToStore.text_content = actualTextContent;
      // If using vector search, generate embeddings for actualTextContent here.

      const esIndexResult = await esTools.index_document({
        index: RAG_CONFIG.ELASTICSEARCH_INDEX,
        document_body: docToStore // This will index the placeholder text_content for now
      });
      
      await Messages.insertAsync({
        text: `Document "${fileInfo.name}" received. Placeholder processing: Indexed in ES with ID: ${esIndexResult?._id}. Review indexed text_content. Full text extraction from various file types and embedding generation are pending further implementation within this method.`,
        createdAt: new Date(), userId: "system-process", owner: "System", type: "system-info"
      });
      return { status: "processing_initiated_placeholder_integrated", esId: esIndexResult?._id };

    } catch (e) {
      console.error("Error during placeholder document processing/indexing:", e);
      await Messages.insertAsync({
        text: `Error processing document "${fileInfo.name}": ${e.message}`,
        createdAt: new Date(), userId: "system-error", owner: "System", type: "error"
      });
      throw new Meteor.Error("document-processing-error-integrated", `Failed to process document: ${e.message}`);
    }
  },
});

