// imports/mcp/client.js

import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";
import { Messages } from "../api/messages.js";

const OZWELL_API_URL = Meteor.settings.private?.OZWELL_API_URL;
const OZWELL_API_KEY = Meteor.settings.private?.OZWELL_API_KEY;
const MONGODB_MCP_URL = Meteor.settings.private?.MONGODB_MCP_SERVER_URL;
const ELASTICSEARCH_MCP_URL = Meteor.settings.private?.ELASTICSEARCH_MCP_SERVER_URL;

export const mcpOzwellClient = {
  async sendMessageToOzwell(userQuery) {
    if (!OZWELL_API_URL || !OZWELL_API_KEY) {
      console.error("Ozwell API URL or Key is not configured in settings.json");
      throw new Meteor.Error("config-error", "Ozwell LLM service is not configured.");
    }
    if (Meteor.isServer) {
      try {
        console.log(`Sending query to Ozwell LLM: ${userQuery}`);
        console.log(`Using Ozwell API URL: ${OZWELL_API_URL}`);
        
        // Construct the API endpoint for completion
        const apiEndpoint = `${OZWELL_API_URL}/v1/completion`;
        console.log(`API Endpoint: ${apiEndpoint}`);
        
        const response = await HTTP.call("POST", apiEndpoint, {
          headers: {
            "Authorization": `Bearer ${OZWELL_API_KEY}`,
            "Content-Type": "application/json",
          },
          data: {
            prompt: userQuery,
            max_tokens: 1000,
            temperature: 0.7
          },
          timeout: 30000, // 30 seconds timeout
        });
        
        console.log(`API response status: ${response.statusCode}`);
        if (response.data) {
          console.log(`Response data structure: ${Object.keys(response.data).join(', ')}`);

          const textSample = response.data.choices?.[0]?.text || response.data.text || JSON.stringify(response.data).substring(0, 100);
          console.log(`Response text extract: ${textSample.substring(0, 100)}...`);
        }
        
        return processResponse(response.data);
      } catch (error) {
        console.error("Error calling Ozwell LLM:", error.response ? error.response.data : error.message);
        throw new Meteor.Error("ozwell-api-error", `Failed to get response from Ozwell LLM: ${error.message}`);
      }
    }
    return null; 
  },
};

async function callMcpServer(serverUrl, serverName, toolName, params) {
  if (!serverUrl) {
    console.error(`${serverName} MCP Server URL is not configured in settings.json`);
    throw new Meteor.Error("config-error", `${serverName} MCP service is not configured.`);
  }
  if (Meteor.isServer) {
    try {
      console.log(`Calling ${serverName} MCP Server: ${serverUrl}, Tool: ${toolName}, Params:`, params);
      const response = await HTTP.call("POST", serverUrl, {
        headers: { "Content-Type": "application/json" }, 
        data: {
          jsonrpc: "2.0",
          method: toolName,
          params: params,
          id: `mcp-${new Date().getTime()}` 
        },
        timeout: 20000, // 20 seconds timeout
      });
      console.log(`${serverName} MCP Server Response for tool ${toolName}:`, response.data);
      if (response.data.error) {
        throw new Meteor.Error("mcp-server-rpc-error", `${serverName} MCP Server Error (${toolName}): ${response.data.error.message} (Code: ${response.data.error.code})`);
      }
      return response.data.result;
    } catch (error) {
      const errorMessage = error.response ? (error.response.data?.error?.message || JSON.stringify(error.response.data)) : error.message;
      console.error(`Error calling ${serverName} MCP Server (${toolName}):`, errorMessage);
      throw new Meteor.Error("mcp-server-http-error", `Failed to call ${serverName} MCP Server tool ${toolName}: ${errorMessage}`);
    }
  }
  return null; // Should only be called from server
}

export const mcpGenericClient = {
  async callMongoDbMcp(toolName, params) {
    return callMcpServer(MONGODB_MCP_URL, "MongoDB", toolName, params);
  },
  async callElasticsearchMcp(toolName, params) {
    return callMcpServer(ELASTICSEARCH_MCP_URL, "Elasticsearch", toolName, params);
  },
  // Future EHR MCP client can be added here
  // async callEhrMcp(toolName, params) {
  //   const EHR_MCP_URL = Meteor.settings.private?.EHR_MCP_SERVER_URL;
  //   return callMcpServer(EHR_MCP_URL, "EHR", toolName, params);
  // },
};

/**
 * Creates a system prompt to guide Ozwell about available tools and formats
 * @returns {string} System prompt with tool instructions
 */
export function createToolAwareSystemPrompt() {
  return `
You have access to database tools for both Elasticsearch and MongoDB. 
If the user's request requires retrieving, searching, or manipulating data, you MUST include tool execution instructions in your response.

When you determine a database tool should be used, ALWAYS format your response EXACTLY like this:
1. First, give a natural language response to the user's question
2. Then include a JSON block with tool execution instructions in this format:

\`\`\`json
{
  "target": "elasticsearch",
  "tool": "search_documents",
  "params": {
    "index": "ozwell_documents",
    "query_body": {
      "query": {
        "match": {
          "text_content": "search term"
        }
      }
    }
  }
}
\`\`\`

Available Elasticsearch tools and required parameters:
- search_documents: Search by keywords
  Required params: index (string), query_body (object with query field)
  Example: {"index": "ozwell_documents", "query_body": {"query": {"match": {"text_content": "john doe"}}}}

- vector_search_documents: Semantic search
  Required params: index (string), vector_field (string), query_vector (array)
  
- get_document: Retrieve by ID
  Required params: index (string), id (string)
  
- index_document: Add a new document
  Required params: index (string), document_body (object)
  
- update_document: Update an existing document
  Required params: index (string), id (string), update_body (object)
  
- delete_document: Remove a document
  Required params: index (string), id (string)

Available MongoDB tools and required parameters:
- find_documents: Query documents in a collection
  Required params: collection (string), query (object)
  Example: {"collection": "documents", "query": {"title": "Smart Chart"}}
  
- insert_document: Add a new document to a collection
  Required params: collection (string), document (object)
  
- update_documents: Update documents in a collection
  Required params: collection (string), query (object), update (object)
  
- delete_documents: Remove documents from a collection
  Required params: collection (string), query (object)
  
- count_documents: Count documents matching criteria
  Required params: collection (string), query (object)
  
- list_collections: List available collections
  Required params: {} (empty object)

IMPORTANT INSTRUCTIONS:
1. The system will automatically execute your tool instructions, so be sure to include ALL required parameters.
2. For searches related to patients, medical records, or documents, use the search_documents tool with the index "ozwell_documents"
3. When searching for specific text like names or terms, use the "match" query in Elasticsearch.
4. NEVER make up or fabricate parameters - use the exact format shown in the examples.
5. Put the JSON in a code block exactly as shown above - the formatting is critical.

When a user asks about finding information in documents or searching for content, ALWAYS include the appropriate tool execution instructions.
`;
}

/**
 * Cleans Ozwell's response text by removing JSON blocks and technical instructions
 * @param {string} responseText - The original response text
 * @returns {string} Cleaned response suitable for user display
 */
export function cleanResponseText(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return responseText;
  }
  
  // Remove JSON code blocks
  let cleaned = responseText.replace(/```json[\s\S]*?```/g, '');
  
  // Remove other code blocks that might contain JSON
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  
  // Remove raw JSON patterns
  cleaned = cleaned.replace(/\{[\s\S]*?"target"[\s\S]*?"tool"[\s\S]*?"params"[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"mcp_instructions"[\s\S]*?\}/g, '');
  
  // Clean up any excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();
  
  return cleaned || responseText;
}

function processResponse(data) {
  if (!data) {
    throw new Meteor.Error("api-response-error", "The API returned an empty response.");
  }
  
  console.log("Processing API response:", JSON.stringify(data));
  
  // Extract the response based on common API formats
  let responseText = "";
  
  if (typeof data === 'string') {
    responseText = data;
  } else if (typeof data === 'object') {
    // Try various common response formats
    responseText = data.answer || 
                  data.text || 
                  data.content || 
                  data.message?.content ||
                  data.choices?.[0]?.message?.content ||
                  data.choices?.[0]?.text ||
                  data.response ||
                  data.completion ||
                  data.generated_text ||
                  data.result ||
                  JSON.stringify(data);
  } else {
    responseText = "Received unexpected response format: " + 
                  (typeof data) + " " + 
                  JSON.stringify(data);
  }
  
  // Extract any potential MCP instructions from the response
  const mcpInstructions = extractMcpInstructions(data);
  
  return {
    answer: responseText,
    responseText: responseText,
    mcp_instructions: mcpInstructions
  };
}

/**
 * Enhanced function to extract MCP instructions from various response formats
 * @param {Object} apiResponse - The response from Ozwell API
 * @returns {Object|null} - Extracted instructions or null if none found
 */
function extractMcpInstructions(apiResponse) {
  // Skip extraction if response is null or not an object
  if (!apiResponse || typeof apiResponse !== 'object') {
    return null;
  }
  
  try {
    console.log("Checking for MCP instructions in:", JSON.stringify(apiResponse));
    
    // Direct mcp_instructions field
    if (apiResponse.mcp_instructions) {
      return apiResponse.mcp_instructions;
    } 
    
    // Look for tool_calls in various formats
    if (apiResponse.tool_calls && apiResponse.tool_calls.length > 0) {
      const toolCall = apiResponse.tool_calls[0];
      return {
        target: toolCall.target || "unknown",
        tool: toolCall.function?.name || toolCall.name,
        params: toolCall.function?.arguments ? 
               (typeof toolCall.function.arguments === 'string' ? 
                JSON.parse(toolCall.function.arguments) : 
                toolCall.function.arguments) : 
               {}
      };
    }
    
    if (apiResponse.choices && 
        apiResponse.choices[0]?.message?.tool_calls && 
        apiResponse.choices[0].message.tool_calls.length > 0) {
      
      const toolCall = apiResponse.choices[0].message.tool_calls[0];
      return {
        target: "unknown", 
        tool: toolCall.function?.name,
        params: toolCall.function?.arguments ? 
               (typeof toolCall.function.arguments === 'string' ? 
                JSON.parse(toolCall.function.arguments) : 
                toolCall.function.arguments) : 
               {}
      };
    }
    
    // Extract JSON from text response (for LLMs that put JSON in their text output)
    if (apiResponse.answer && typeof apiResponse.answer === 'string') {
      // Look for JSON in code blocks
      const jsonCodeBlockRegex = /```json\s*([\s\S]*?)\s*```/;
      const jsonBlockMatch = apiResponse.answer.match(jsonCodeBlockRegex);
      
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        try {
          const jsonObj = JSON.parse(jsonBlockMatch[1]);
          if (jsonObj.mcp_instructions) {
            return jsonObj.mcp_instructions;
          }
          if (jsonObj.target && jsonObj.tool) {
            return jsonObj;
          }
        } catch (e) {
          console.warn("Failed to parse JSON code block:", e);
        }
      }
      
      // Look for raw JSON object with expected pattern
      const rawJsonRegex = /\{[\s\S]*?"target"[\s\S]*?"tool"[\s\S]*?"params"[\s\S]*?\}/;
      const rawJsonMatch = apiResponse.answer.match(rawJsonRegex);
      
      if (rawJsonMatch && rawJsonMatch[0]) {
        try {
          const jsonObj = JSON.parse(rawJsonMatch[0]);
          if (jsonObj.target && jsonObj.tool) {
            return jsonObj;
          }
        } catch (e) {
          console.warn("Failed to parse raw JSON in response:", e);
        }
      }
      
      // Look for mcp_instructions object in raw JSON
      const mcpInstructionsRegex = /\{[\s\S]*?"mcp_instructions"[\s\S]*?\}/;
      const mcpInstructionsMatch = apiResponse.answer.match(mcpInstructionsRegex);
      
      if (mcpInstructionsMatch && mcpInstructionsMatch[0]) {
        try {
          const jsonObj = JSON.parse(mcpInstructionsMatch[0]);
          if (jsonObj.mcp_instructions) {
            return jsonObj.mcp_instructions;
          }
        } catch (e) {
          console.warn("Failed to parse mcp_instructions JSON in response:", e);
        }
      }
    }
    
    return null;
  } catch (e) {
    console.error("Error extracting MCP instructions:", e);
    return null;
  }
}

// imports/mcp/client.js - Updated executeToolsFromResponse function

/**
 * Executes database tools based on instructions from Ozwell
 * @param {Object} ozwellResponse - The parsed response from Ozwell
 * @returns {Promise<Object>} - The result of tool execution
 */
export async function executeToolsFromResponse(ozwellResponse) {
  if (!ozwellResponse) {
    console.error("No Ozwell response provided");
    return null;
  }
  
  console.log("executeToolsFromResponse: Processing response", 
    ozwellResponse.choices ? 
      `with ${ozwellResponse.choices.length} choices` : 
      "without choices array");
  
  // Extract instructions from the response
  let instructions = null;
  
  // Try to extract from choices array (Ozwell format)
  if (ozwellResponse.choices && ozwellResponse.choices.length > 0) {
    const content = ozwellResponse.choices[0].message?.content;
    
    if (content) {
      // Look for JSON in code blocks
      const codeBlockMatch = content.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
      
      if (codeBlockMatch && codeBlockMatch[1]) {
        try {
          const parsedJson = JSON.parse(codeBlockMatch[1]);
          
          if (parsedJson.target && parsedJson.tool && parsedJson.params) {
            instructions = parsedJson;
            console.log("Found instructions in code block:", JSON.stringify(instructions));
          } else if (parsedJson.mcp_instructions) {
            instructions = parsedJson.mcp_instructions;
            console.log("Found mcp_instructions in code block:", JSON.stringify(instructions));
          }
        } catch (e) {
          console.error("Error parsing JSON from code block:", e);
        }
      }
    }
  }
  
  // Try direct mcp_instructions field if not found in choices
  if (!instructions && ozwellResponse.mcp_instructions) {
    instructions = ozwellResponse.mcp_instructions;
    console.log("Found direct mcp_instructions:", JSON.stringify(instructions));
  }
  
  // Try to extract from responseText if still not found
  if (!instructions && (ozwellResponse.answer || ozwellResponse.responseText)) {
    const responseText = ozwellResponse.answer || ozwellResponse.responseText;
    
    // Look for JSON in code blocks
    const codeBlockMatch = responseText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
    
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        const parsedJson = JSON.parse(codeBlockMatch[1]);
        
        if (parsedJson.target && parsedJson.tool && parsedJson.params) {
          instructions = parsedJson;
          console.log("Found instructions in response text code block:", JSON.stringify(instructions));
        } else if (parsedJson.mcp_instructions) {
          instructions = parsedJson.mcp_instructions;
          console.log("Found mcp_instructions in response text code block:", JSON.stringify(instructions));
        }
      } catch (e) {
        console.error("Error parsing JSON from response text code block:", e);
      }
    }
  }
  
  // If no instructions found, return the original response
  if (!instructions) {
    console.log("No executable instructions found in response");
    return ozwellResponse;
  }
  
  try {
    // Normalize target name to handle variations
    const target = (instructions.target || "").toLowerCase();
    const tool = instructions.tool;
    const params = instructions.params || {};
    
    // Add validation for required fields
    if (!target || !tool) {
      console.error("Invalid MCP instruction: missing target or tool");
      return ozwellResponse;
    }
    
    // Log the start of execution - visible in UI
    await Messages.insertAsync({
      text: `Executing ${target} tool: ${tool}`,
      createdAt: new Date(),
      userId: "system-auto",
      owner: "System",
      type: "system-info",
    });
    
    console.log(`Executing ${target} tool: ${tool} with params:`, JSON.stringify(params));
    
    // Execute the appropriate tool based on target
    let result;
    let methodName;
    
    if (target === "elasticsearch" || target === "es") {
      methodName = 'mcp.callElasticsearch';
    } else if (target === "mongodb" || target === "mongo" || target === "db") {
      methodName = 'mcp.callMongo';
    } else {
      throw new Error(`Unknown target system: ${target}`);
    }
    
    // Call the method
    console.log(`Calling Meteor method ${methodName} with tool ${tool} and params`, JSON.stringify(params));
    result = await Meteor.callAsync(methodName, tool, params);
    console.log(`Tool execution completed with result:`, 
      typeof result === 'object' ? 
        (result ? `Object with keys: ${Object.keys(result).join(', ')}` : 'null object') : 
        result);
    
    // For Elasticsearch search results, format them nicely
    if (tool === 'search_documents' && result && result.hits && result.hits.hits) {
      const hits = result.hits.hits;
      const totalHits = result.hits.total && (result.hits.total.value !== undefined ? 
          result.hits.total.value : result.hits.total) || hits.length;
      
      console.log(`Found ${totalHits} search results`);
      
      // Insert a summary message
      await Messages.insertAsync({
        text: `Found ${totalHits} document(s) matching your search.`,
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: target.charAt(0).toUpperCase() + target.slice(1),
        type: "system-info",
      });
      
      // Show each hit (up to 3) in a separate message for better readability
      for (let i = 0; i < Math.min(hits.length, 3); i++) {
        const hit = hits[i];
        const source = hit._source || {};
        
        let content = `Result ${i+1}:\n`;
        if (source.title) content += `Title: ${source.title}\n`;
        if (source.original_filename) content += `File: ${source.original_filename}\n`;
        
        // Extract and format content snippet
        if (source.text_content) {
          // Clean up text (remove excessive newlines, etc.)
          let textContent = source.text_content
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s{3,}/g, ' ');
          
          // Extract a relevant snippet (first 500 chars)
          const snippet = textContent.substring(0, 500) + 
            (textContent.length > 500 ? "..." : "");
          
          content += `Content:\n${snippet}\n`;
        }
        
        // Include hit ID if available
        if (hit._id) content += `Document ID: ${hit._id}`;
        
        await Messages.insertAsync({
          text: content,
          createdAt: new Date(),
          userId: `system-${target}`,
          owner: `${target.charAt(0).toUpperCase() + target.slice(1)} (Integrated)`,
          type: "mcp-response",
        });
      }
      
      // If there are more results, mention it
      if (hits.length > 3) {
        await Messages.insertAsync({
          text: `... and ${hits.length - 3} more results not shown.`,
          createdAt: new Date(),
          userId: `system-${target}`,
          owner: target.charAt(0).toUpperCase() + target.slice(1),
          type: "system-info",
        });
      }
    } 
    // For other results, just show them directly
    else if (result) {
      await Messages.insertAsync({
        text: typeof result === 'object' ? 
          JSON.stringify(result, null, 2) : 
          String(result),
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: `${target.charAt(0).toUpperCase() + target.slice(1)} (Integrated)`,
        type: "mcp-response",
      });
    } 
    // Handle no results
    else {
      await Messages.insertAsync({
        text: `The ${tool} operation completed, but no results were returned.`,
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: target.charAt(0).toUpperCase() + target.slice(1),
        type: "system-info",
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
 * Helper function to extract instruction JSON from text
 * @param {string} text - The text to search for JSON instructions
 * @returns {Object|null} - Extracted instructions or null if none found
 */
function extractInstructionsFromText(text) {
  if (!text) return null;
  
  console.log("Extracting instructions from text:", text.substring(0, 200) + "...");
  
  // Look for JSON patterns in the text
  const jsonBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/;
  const match = text.match(jsonBlockRegex);
  
  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1]);
      console.log("Parsed JSON from code block:", parsed);
      
      // Check if it's in the expected format
      if (parsed.mcp_instructions) {
        return parsed.mcp_instructions;
      }
      
      // Or if it has the direct format
      if (parsed.target && parsed.tool) {
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse JSON block in response:", e);
    }
  }
  
  // Try to find raw JSON
  const rawJsonRegex = /{[\s\S]*?"target"[\s\S]*?"tool"[\s\S]*?"params"[\s\S]*?}/;
  const rawMatch = text.match(rawJsonRegex);
  
  if (rawMatch && rawMatch[0]) {
    try {
      const parsed = JSON.parse(rawMatch[0]);
      console.log("Parsed raw JSON from text:", parsed);
      if (parsed.target && parsed.tool) {
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse raw JSON in response:", e);
    }
  }
  
  return null;
}