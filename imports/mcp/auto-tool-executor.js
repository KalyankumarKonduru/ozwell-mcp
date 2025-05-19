// imports/mcp/auto-tool-executor.js

import { Meteor } from "meteor/meteor";
import { Messages } from "../api/messages.js";

/**
 * Processes responses from Ozwell AI and executes any database tools requested
 * @param {Object} ozwellResponse - The response from Ozwell
 * @param {String} userQuery - The original user query
 * @returns {Promise<Object>} Enhanced response with execution results
 */
export async function executeToolsFromResponse(ozwellResponse, userQuery) {
  // Exit early if no instructions are found
  if (!ozwellResponse || !ozwellResponse.mcp_instructions) {
    return ozwellResponse;
  }
  
  const instruction = ozwellResponse.mcp_instructions;
  console.log("Detected tool instruction:", JSON.stringify(instruction, null, 2));
  
  try {
    // Normalize target name to handle variations
    const target = (instruction.target || "").toLowerCase();
    const tool = instruction.tool;
    const params = instruction.params || {};
    
    // Add validation for required fields
    if (!target || !tool) {
      console.error("Invalid MCP instruction: missing target or tool");
      return ozwellResponse;
    }
    
    // Log the start of execution
    await Messages.insertAsync({
      text: `Executing ${target} tool: ${tool}`,
      createdAt: new Date(),
      userId: "system-auto",
      owner: "System",
      type: "system-info",
    });
    
    // Execute the appropriate tool based on target
    let result;
    if (target === "elasticsearch" || target === "es") {
      result = await Meteor.callAsync('mcp.callElasticsearch', tool, params);
    } else if (target === "mongodb" || target === "mongo") {
      result = await Meteor.callAsync('mcp.callMongo', tool, params);
    } else {
      throw new Error(`Unknown target system: ${target}`);
    }
    
    // Add the result to the chat
    await Messages.insertAsync({
      text: `${target.charAt(0).toUpperCase() + target.slice(1)} Tool Result:`,
      createdAt: new Date(),
      userId: `system-${target}`,
      owner: target.charAt(0).toUpperCase() + target.slice(1),
      type: "mcp-response",
    });
    
    // For large results, summarize and format them appropriately
    if (typeof result === 'object') {
      const resultStr = JSON.stringify(result, null, 2);
      
      // For very large results, split into chunks
      if (resultStr.length > 5000) {
        // Add a summary of the result
        await Messages.insertAsync({
          text: `Result is ${resultStr.length} characters long. Showing summary:`,
          createdAt: new Date(),
          userId: `system-${target}`,
          owner: target.charAt(0).toUpperCase() + target.slice(1),
          type: "mcp-response",
        });
        
        // If it's an array, show length and first few items
        if (Array.isArray(result)) {
          await Messages.insertAsync({
            text: `Found ${result.length} items. First ${Math.min(3, result.length)} items: ${JSON.stringify(result.slice(0, 3), null, 2)}`,
            createdAt: new Date(),
            userId: `system-${target}`,
            owner: target.charAt(0).toUpperCase() + target.slice(1),
            type: "mcp-response",
          });
        } else {
          // For objects, show keys and a subset of values
          const keys = Object.keys(result);
          await Messages.insertAsync({
            text: `Result has ${keys.length} properties: ${keys.join(', ')}`,
            createdAt: new Date(),
            userId: `system-${target}`,
            owner: target.charAt(0).toUpperCase() + target.slice(1),
            type: "mcp-response",
          });
        }
      } else {
        // For smaller results, show everything
        await Messages.insertAsync({
          text: resultStr,
          createdAt: new Date(),
          userId: `system-${target}`,
          owner: target.charAt(0).toUpperCase() + target.slice(1),
          type: "mcp-response",
        });
      }
    } else {
      // For non-object results
      await Messages.insertAsync({
        text: String(result),
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: target.charAt(0).toUpperCase() + target.slice(1),
        type: "mcp-response",
      });
    }
    
    return {
      ...ozwellResponse,
      toolExecutionResult: result
    };
  } catch (error) {
    console.error("Error executing tool:", error);
    
    // Add the error to the chat
    await Messages.insertAsync({
      text: `Error executing tool: ${error.reason || error.message}`,
      createdAt: new Date(),
      userId: "system-error",
      owner: "System",
      type: "error",
    });
    
    return {
      ...ozwellResponse,
      toolExecutionError: error.reason || error.message
    };
  }
}

/**
 * Creates a system prompt for Ozwell with tool instructions
 * This is appended to user queries to guide Ozwell's responses
 */
export function createToolAwareSystemPrompt() {
  return `
As an AI assistant with access to database tools, analyze the user's request and determine if it requires database operations. 
If the request involves retrieving, querying, or manipulating data, respond normally to the user first, then include technical instructions for executing the appropriate database tool.

Format for tool instructions:

\`\`\`json
{
  "mcp_instructions": {
    "target": "[elasticsearch or mongodb]",
    "tool": "[specific_tool_name]",
    "params": {
      // Tool-specific parameters
    }
  }
}
\`\`\`

Available Elasticsearch tools:
- search_documents: Search for documents matching criteria
  Params: index (string), query_body (object), from/size (pagination)
  Example: {"index": "ozwell_documents", "query_body": {"query": {"match": {"text_content": "search term"}}}}

- vector_search_documents: Search using vector embeddings
  Params: index (string), vector_field (string), query_vector (array of numbers), k (number)
  Example: {"index": "ozwell_documents", "vector_field": "embedding_vector", "query_vector": [...], "k": 5}

- index_document: Add a new document
  Params: index (string), id (string, optional), document_body (object)
  Example: {"index": "ozwell_documents", "document_body": {"title": "New Document", "text_content": "Content..."}}

- update_document: Update an existing document
  Params: index (string), id (string), update_body (object)
  Example: {"index": "ozwell_documents", "id": "doc123", "update_body": {"doc": {"title": "Updated Title"}}}

- delete_document: Remove a document
  Params: index (string), id (string)
  Example: {"index": "ozwell_documents", "id": "doc123"}

- get_document: Retrieve a specific document
  Params: index (string), id (string)
  Example: {"index": "ozwell_documents", "id": "doc123"}

Available MongoDB tools:
- find_documents: Query documents
  Params: collection (string), query (object), projection (object, optional), sort (object, optional), limit (number, optional)
  Example: {"collection": "documents", "query": {"title": "Report"}, "limit": 10}

- insert_document: Add new documents
  Params: collection (string), document (object or array)
  Example: {"collection": "documents", "document": {"title": "New Doc", "content": "Text..."}}

- update_documents: Update existing documents
  Params: collection (string), query (object), update (object), options (object, optional)
  Example: {"collection": "documents", "query": {"_id": "123"}, "update": {"$set": {"status": "approved"}}}

- delete_documents: Remove documents
  Params: collection (string), query (object), options (object, optional)
  Example: {"collection": "documents", "query": {"status": "expired"}}

- count_documents: Count number of documents
  Params: collection (string), query (object)
  Example: {"collection": "documents", "query": {"category": "reports"}}

- list_collections: Show available collections
  Params: database (string, optional)
  Example: {"database": "ozwell"}

These instructions will be automatically executed by the system without user intervention.
`;
}