// imports/mcp/client.js - CLEANED VERSION (External MCP Only)

import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";
import { Messages } from "../api/messages.js";

const OZWELL_API_URL = Meteor.settings.private?.OZWELL_API_URL;
const OZWELL_API_KEY = Meteor.settings.private?.OZWELL_API_KEY;

// External MCP server URLs
const MONGODB_MCP_URL = Meteor.settings.private?.MONGODB_MCP_SERVER_URL || "http://localhost:3001/mcp";
const ELASTICSEARCH_MCP_URL = Meteor.settings.private?.ELASTICSEARCH_MCP_SERVER_URL || "http://localhost:3002/mcp";

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
          timeout: 30000,
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

// External MCP client for standalone servers  
async function callExternalMcpServer(serverUrl, serverName, toolName, params) {
  if (!serverUrl) {
    console.error(`${serverName} MCP Server URL is not configured`);
    throw new Meteor.Error("config-error", `${serverName} MCP service is not configured.`);
  }
  
  if (Meteor.isServer) {
    try {
      console.log(`📡 Calling external ${serverName} MCP Server: ${serverUrl}`);
      console.log(`🔧 Tool: ${toolName}`, params);
      
      const response = await HTTP.call("POST", serverUrl, {
        headers: { "Content-Type": "application/json" }, 
        data: {
          jsonrpc: "2.0",
          method: toolName,
          params: params,
          id: `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        },
        timeout: 30000,
      });
      
      console.log(`📨 ${serverName} MCP Server Response:`, {
        status: response.statusCode,
        hasResult: !!response.data?.result,
        hasError: !!response.data?.error
      });
      
      if (response.data.error) {
        throw new Meteor.Error("mcp-server-rpc-error", 
          `${serverName} MCP Server Error (${toolName}): ${response.data.error.message} (Code: ${response.data.error.code})`);
      }
      
      return response.data.result;
    } catch (error) {
      const errorMessage = error.response ? 
        (error.response.data?.error?.message || JSON.stringify(error.response.data)) : 
        error.message;
      
      console.error(`❌ Error calling ${serverName} MCP Server (${toolName}):`, errorMessage);
      
      // Check if it's a connection error
      if (error.response?.statusCode === undefined || error.message.includes('ECONNREFUSED')) {
        throw new Meteor.Error("mcp-server-connection-error", 
          `Cannot connect to ${serverName} MCP Server at ${serverUrl}. Please ensure the server is running.`);
      }
      
      throw new Meteor.Error("mcp-server-http-error", 
        `Failed to call ${serverName} MCP Server tool ${toolName}: ${errorMessage}`);
    }
  }
  return null;
}

export const mcpExternalClient = {
  async callMongoDbMcp(toolName, params) {
    return callExternalMcpServer(MONGODB_MCP_URL, "MongoDB", toolName, params);
  },
  
  async callElasticsearchMcp(toolName, params) {
    return callExternalMcpServer(ELASTICSEARCH_MCP_URL, "Elasticsearch", toolName, params);
  },
  
  // Health check methods
  async checkMongoDbMcpHealth() {
    try {
      const healthUrl = MONGODB_MCP_URL.replace('/mcp', '/health');
      const response = await HTTP.call("GET", healthUrl, { timeout: 5000 });
      return response.data;
    } catch (error) {
      console.error("MongoDB MCP Server health check failed:", error);
      return { status: 'unhealthy', error: error.message };
    }
  },
  
  async checkElasticsearchMcpHealth() {
    try {
      const healthUrl = ELASTICSEARCH_MCP_URL.replace('/mcp', '/health');
      const response = await HTTP.call("GET", healthUrl, { timeout: 5000 });
      return response.data;
    } catch (error) {
      console.error("Elasticsearch MCP Server health check failed:", error);
      return { status: 'unhealthy', error: error.message };
    }
  }
};

/**
 * Creates a system prompt to guide Ozwell about available tools and formats
 */
export function createToolAwareSystemPrompt() {
  return `
You have access to database tools via external MCP servers for both Elasticsearch and MongoDB. 
If the user's request requires retrieving, searching, or manipulating data, you MUST include tool execution instructions in your response.

IMPORTANT: After executing tools and receiving results, provide ONLY the specific information requested by the user. Do not include extra details unless specifically asked.

Response Format Rules:
1. If user asks for specific information (like "diagnosis"), extract and show only that information
2. If user asks for general information, provide a summary
3. Always cite the source document when providing medical information
4. Be concise and precise - don't overwhelm with unnecessary details

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

Available Elasticsearch tools (via external MCP server):
- search_documents: Search by keywords
  Required params: index (string), query_body (object with query field)
  Example: {"index": "ozwell_documents", "query_body": {"query": {"match": {"text_content": "john doe"}}}}

- vector_search_documents: Semantic search using vector embeddings
  Required params: index (string), vector_field (string), query_vector (array)
  
- get_document: Retrieve by ID
  Required params: index (string), id (string)
  
- index_document: Add a new document
  Required params: index (string), document_body (object)
  
- update_document: Update an existing document
  Required params: index (string), id (string), update_body (object)
  
- delete_document: Remove a document
  Required params: index (string), id (string)

Available MongoDB tools (via external MCP server):
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

RESPONSE PRECISION EXAMPLES:
- User asks: "What is John Doe's diagnosis?" 
  → Show only: "John Doe's diagnosis: Acute Bronchitis, Mild Dehydration"
- User asks: "What medications is John Doe taking?"
  → Show only: "John Doe's medications: Amoxicillin 500mg, 3 times a day for 7 days; Oral Rehydration Salts as needed"
- User asks: "Tell me about John Doe's patient record"
  → Show full relevant information

IMPORTANT INSTRUCTIONS:
1. The system will automatically execute your tool instructions via external MCP servers
2. For searches related to patients, medical records, or documents, use the search_documents tool with the index "ozwell_documents"
3. When searching for specific text like names or terms, use the "match" query in Elasticsearch
4. NEVER make up or fabricate parameters - use the exact format shown in the examples
5. Put the JSON in a code block exactly as shown above - the formatting is critical
6. External MCP servers handle the actual database operations with proper authentication and security
7. AFTER receiving search results, extract and present ONLY the information specifically requested by the user

When a user asks about finding information in documents or searching for content, ALWAYS include the appropriate tool execution instructions.
`;
}

/**
 * Cleans Ozwell's response text by removing JSON blocks and technical instructions
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
      return extractJsonFromText(apiResponse.answer);
    }
    
    return null;
  } catch (e) {
    console.error("Error extracting MCP instructions:", e);
    return null;
  }
}

function extractJsonFromText(text) {
  if (!text) return null;
  
  // Look for JSON in code blocks
  const jsonCodeBlockRegex = /```json\s*([\s\S]*?)\s*```/;
  const jsonBlockMatch = text.match(jsonCodeBlockRegex);
  
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
  const rawJsonMatch = text.match(rawJsonRegex);
  
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
  
  return null;
}

/**
 * Executes database tools based on instructions from Ozwell using external MCP servers
 */
export async function executeToolsFromResponse(ozwellResponse) {
  if (!ozwellResponse) {
    console.error("No Ozwell response provided");
    return null;
  }
  
  console.log("executeToolsFromResponse: Processing response for external MCP execution");
  
  // Extract instructions from the response
  let instructions = null;
  
  // Try to extract from choices array (Ozwell format)
  if (ozwellResponse.choices && ozwellResponse.choices.length > 0) {
    const content = ozwellResponse.choices[0].message?.content;
    
    if (content) {
      instructions = extractInstructionsFromText(content);
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
    instructions = extractInstructionsFromText(responseText);
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
      text: `🔧 Executing ${target} tool via external MCP server: ${tool}`,
      createdAt: new Date(),
      userId: "system-auto",
      owner: "MCP Client",
      type: "system-info",
    });
    
    console.log(`📡 Executing external ${target} MCP tool: ${tool} with params:`, JSON.stringify(params));
    
    // Execute the appropriate tool based on target using external MCP clients
    let result;
    let methodName;
    
    if (target === "elasticsearch" || target === "es") {
      methodName = 'mcp.callElasticsearchExternal';
      result = await Meteor.callAsync(methodName, tool, params);
    } else if (target === "mongodb" || target === "mongo" || target === "db") {
      methodName = 'mcp.callMongoExternal';
      result = await Meteor.callAsync(methodName, tool, params);
    } else {
      throw new Error(`Unknown target system: ${target}`);
    }
    
    console.log(`🎯 External MCP tool execution completed`);
    
    // For Elasticsearch search results, format them nicely
    if (tool === 'search_documents' && result && result.hits) {
      const hits = result.hits;
      const totalHits = result.total || hits.length;
      
      console.log(`🔍 External MCP found ${totalHits} search results`);
      
      // Insert a summary message
      await Messages.insertAsync({
        text: `✅ Found ${totalHits} document(s) via external Elasticsearch MCP server`,
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: `${target.charAt(0).toUpperCase() + target.slice(1)} MCP`,
        type: "system-info",
      });
      
      // Show each hit (up to 3) in a separate message for better readability
      for (let i = 0; i < Math.min(hits.length, 3); i++) {
        const hit = hits[i];
        const source = hit._source || hit.source || {};
        
        let content = `📄 Result ${i+1}:\n`;
        content += `Title: ${source.title || 'Untitled'}\n`;
        if (source.original_filename) content += `File: ${source.original_filename}\n`;
        
        // Extract and format content snippet
        if (source.text_content) {
          // Clean up text (remove excessive newlines, etc.)
          let textContent = source.text_content
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s{3,}/g, ' ');
          
          content += `Content:\n${textContent}`;
        }
        
        // Include hit ID if available
        if (hit._id || hit.id) content += `\nDocument ID: ${hit._id || hit.id}`;
        
        await Messages.insertAsync({
          text: content,
          createdAt: new Date(),
          userId: `system-${target}`,
          owner: `${target.charAt(0).toUpperCase() + target.slice(1)} MCP Server`,
          type: "mcp-response",
        });
      }
      
      // If there are more results, mention it
      if (hits.length > 3) {
        await Messages.insertAsync({
          text: `📊 ... and ${hits.length - 3} more results not shown.`,
          createdAt: new Date(),
          userId: `system-${target}`,
          owner: `${target.charAt(0).toUpperCase() + target.slice(1)} MCP`,
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
        owner: `${target.charAt(0).toUpperCase() + target.slice(1)} MCP Server`,
        type: "mcp-response",
      });
    } 
    // Handle no results
    else {
      await Messages.insertAsync({
        text: `ℹ️ The ${tool} operation completed via external MCP server, but no results were returned.`,
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: `${target.charAt(0).toUpperCase() + target.slice(1)} MCP`,
        type: "system-info",
      });
    }
    
    return {
      ...ozwellResponse,
      toolExecutionResult: result
    };
  } catch (error) {
    console.error("❌ Error executing external MCP tool:", error);
    
    // Add the error to the chat
    await Messages.insertAsync({
      text: `❌ Error executing external MCP tool: ${error.reason || error.message}`,
      createdAt: new Date(),
      userId: "system-error",
      owner: "MCP Client",
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