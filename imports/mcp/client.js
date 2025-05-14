import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";


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

function extractMcpInstructions(apiResponse) {
  // Skip extraction if response is null or not an object
  if (!apiResponse || typeof apiResponse !== 'object') {
    return null;
  }
  
  try {
    console.log("Checking for MCP instructions in:", JSON.stringify(apiResponse));
    
    // Various formats of potential MCP instructions
    if (apiResponse.mcp_instructions) {
      return apiResponse.mcp_instructions;
    } 
    
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
    
    return null;
  } catch (e) {
    console.error("Error extracting MCP instructions:", e);
    return null;
  }
}
