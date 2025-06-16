// imports/mcp/client.js - Ozwell Function Calling Implementation

import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";
import { Messages } from "../api/messages.js";

const OZWELL_API_URL = Meteor.settings.private?.OZWELL_API_URL;
const OZWELL_API_KEY = Meteor.settings.private?.OZWELL_API_KEY;

// HTTP MCP Server URLs
const MCP_SERVERS = {
  mongodb: Meteor.settings.private?.MONGODB_MCP_SERVER_URL || 'http://localhost:3001/mcp',
  elasticsearch: Meteor.settings.private?.ELASTICSEARCH_MCP_SERVER_URL || 'http://localhost:3002/mcp',
  fhir: Meteor.settings.private?.FHIR_MCP_SERVER_URL || 'http://localhost:3003/mcp'
};

// Define available functions for Ozwell
const AVAILABLE_FUNCTIONS = [
  {
    name: "search_documents",
    description: "Search through uploaded documents and files for specific content using Elasticsearch",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search terms or keywords to find in documents"
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
          default: 5
        }
      },
      required: ["query"]
    }
  },
  {
    name: "find_documents",
    description: "Find and list documents stored in the MongoDB database",
    parameters: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description: "Database collection name",
          default: "documents"
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
          default: 10
        },
        query: {
          type: "object",
          description: "MongoDB query filter (optional)",
          default: {}
        }
      }
    }
  },
  {
    name: "count_documents",
    description: "Count the total number of documents in a database collection",
    parameters: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description: "Collection name to count documents in",
          default: "documents"
        }
      }
    }
  },
  {
    name: "list_collections",
    description: "List all available data collections in the MongoDB database",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "search_patients",
    description: "Search for patients in the FHIR medical records system",
    parameters: {
      type: "object",
      properties: {
        family: {
          type: "string",
          description: "Patient family/last name"
        },
        given: {
          type: "string",
          description: "Patient first/given name"
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 5
        }
      }
    }
  },
  {
    name: "get_patient_observations",
    description: "Get medical observations (lab results, vital signs) for a specific patient",
    parameters: {
      type: "object",
      properties: {
        patient_id: {
          type: "string",
          description: "FHIR Patient ID"
        },
        category: {
          type: "string",
          description: "Observation category (vital-signs, laboratory, etc.)",
          enum: ["vital-signs", "laboratory", "imaging", "survey", "exam", "therapy"]
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
          default: 20
        }
      },
      required: ["patient_id"]
    }
  }
];

export const mcpOzwellClient = {
  async sendMessageToOzwell(userQuery, context = {}) {
    if (!OZWELL_API_URL || !OZWELL_API_KEY) {
      console.error("Ozwell API URL or Key is not configured in settings.json");
      throw new Meteor.Error("config-error", "Ozwell LLM service is not configured.");
    }
    
    if (Meteor.isServer) {
      try {
        console.log(`Sending query to Ozwell with functions: ${userQuery.substring(0, 100)}...`);
        
        // First, try with function calling
        const responseWithFunctions = await this.callOzwellWithFunctions(userQuery);
        
        // Check if Ozwell wants to call a function
        if (responseWithFunctions.function_call) {
          console.log('🔧 Ozwell requested function call:', responseWithFunctions.function_call);
          
          // Execute the function call
          const functionResult = await this.executeFunctionCall(responseWithFunctions.function_call);
          
          // Get Ozwell's interpretation of the results
          const interpretationPrompt = `Based on the function call results: ${JSON.stringify(functionResult, null, 2)}\n\nPlease provide a helpful summary and interpretation of these results for the user who asked: "${userQuery}"`;
          
          const interpretation = await this.callOzwellBasic(interpretationPrompt);
          return interpretation;
        }
        
        return responseWithFunctions;
        
      } catch (error) {
        console.error("Error calling Ozwell LLM:", error.response ? error.response.data : error.message);
        
        // Fallback: try without functions if function calling fails
        console.log("Function calling failed, trying basic call...");
        try {
          return await this.callOzwellBasic(userQuery);
        } catch (fallbackError) {
          throw new Meteor.Error("ozwell-api-error", `Failed to get response from Ozwell LLM: ${fallbackError.message}`);
        }
      }
    }
    return null; 
  },

  async callOzwellWithFunctions(userQuery) {
    const apiEndpoint = `${OZWELL_API_URL}/v1/chat/completions`;
    
    const requestData = {
      model: "gpt-4", // or whatever model Ozwell expects
      messages: [
        {
          role: "user",
          content: userQuery
        }
      ],
      functions: AVAILABLE_FUNCTIONS,
      function_call: "auto",
      max_tokens: 1000,
      temperature: 0.7
    };
    
    const response = await HTTP.call("POST", apiEndpoint, {
      headers: {
        "Authorization": `Bearer ${OZWELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      data: requestData,
      timeout: 30000,
    });
    
    return this.processOzwellResponse(response.data);
  },

  async callOzwellBasic(userQuery) {
    const apiEndpoint = `${OZWELL_API_URL}/v1/completion`;
    
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
    
    return this.processOzwellResponse(response.data);
  },

  processOzwellResponse(data) {
    if (!data) {
      throw new Meteor.Error("api-response-error", "Empty response from Ozwell");
    }
    
    // Handle chat completion format (with function calling)
    if (data.choices && data.choices[0]) {
      const choice = data.choices[0];
      
      // Check for function call
      if (choice.message && choice.message.function_call) {
        return {
          function_call: choice.message.function_call,
          responseText: choice.message.content || "Function call requested"
        };
      }
      
      // Regular message
      const content = choice.message?.content || choice.text || "";
      return {
        responseText: content,
        answer: content
      };
    }
    
    // Handle completion format (basic)
    let responseText = "";
    if (typeof data === 'string') {
      responseText = data;
    } else {
      responseText = data.answer || data.text || data.content || 
                    data.response || data.completion || JSON.stringify(data);
    }
    
    return {
      answer: responseText,
      responseText: responseText
    };
  },

  async executeFunctionCall(functionCall) {
    try {
      const { name, arguments: args } = functionCall;
      
      // Parse arguments if they're a string
      let parsedArgs;
      if (typeof args === 'string') {
        parsedArgs = JSON.parse(args);
      } else {
        parsedArgs = args;
      }
      
      console.log(`🔧 Executing function: ${name}`, parsedArgs);
      
      await Messages.insertAsync({
        text: `🔧 Ozwell is using: ${name}`,
        createdAt: new Date(),
        userId: "system-function",
        owner: "Ozwell Function Call",
        type: "system-info",
      });
      
      let result;
      
      switch (name) {
        case 'search_documents':
          result = await this.searchDocuments(parsedArgs.query, parsedArgs.limit);
          break;
          
        case 'find_documents':
          result = await this.findDocuments(parsedArgs);
          break;
          
        case 'count_documents':
          result = await this.countDocuments(parsedArgs.collection);
          break;
          
        case 'list_collections':
          result = await this.listCollections();
          break;
          
        case 'search_patients':
          result = await this.searchPatients(parsedArgs);
          break;
          
        case 'get_patient_observations':
          result = await this.getPatientObservations(parsedArgs);
          break;
          
        default:
          throw new Error(`Unknown function: ${name}`);
      }
      
      // Display the raw results
      const formattedResult = this.formatFunctionResult(name, result);
      await Messages.insertAsync({
        text: formattedResult,
        createdAt: new Date(),
        userId: "system-function-result",
        owner: "Function Result",
        type: "mcp-response",
      });
      
      return result;
      
    } catch (error) {
      console.error('Error executing function call:', error);
      
      const errorMessage = `❌ Error executing ${functionCall.name}: ${error.message}`;
      await Messages.insertAsync({
        text: errorMessage,
        createdAt: new Date(),
        userId: "system-error",
        owner: "Function Executor",
        type: "error",
      });
      
      throw error;
    }
  },

  async searchDocuments(query, limit = 5) {
    return await mcpSdkClient.callElasticsearchMcp('search_documents', {
      index: 'ozwell_documents',
      query_body: {
        query: {
          multi_match: {
            query: query,
            fields: ['title', 'text_content', 'summary'],
            fuzziness: 'AUTO'
          }
        }
      },
      size: limit
    });
  },

  async findDocuments(params) {
    return await mcpSdkClient.callMongoDbMcp('find_documents', {
      collection: params.collection || 'documents',
      query: params.query || {},
      limit: params.limit || 10
    });
  },

  async countDocuments(collection = 'documents') {
    return await mcpSdkClient.callMongoDbMcp('count_documents', {
      collection: collection,
      query: {}
    });
  },

  async listCollections() {
    return await mcpSdkClient.callMongoDbMcp('list_collections', {});
  },

  async searchPatients(params) {
    const searchParams = {
      _count: params.limit || 5
    };
    
    if (params.family) searchParams.family = params.family;
    if (params.given) searchParams.given = params.given;
    
    return await mcpSdkClient.callFhirMcp('search_patients', searchParams);
  },

  async getPatientObservations(params) {
    const observationParams = {
      patient_id: params.patient_id,
      _count: params.limit || 20
    };
    
    if (params.category) observationParams.category = params.category;
    
    return await mcpSdkClient.callFhirMcp('get_patient_observations', observationParams);
  },

  formatFunctionResult(functionName, result) {
    switch (functionName) {
      case 'search_documents':
        if (result.hits && result.hits.length > 0) {
          let text = `🔍 Found ${result.hits.length} documents:\n\n`;
          result.hits.slice(0, 3).forEach((hit, index) => {
            const source = hit._source || {};
            text += `**${index + 1}. ${source.title || 'Untitled'}**\n`;
            if (source.text_content) {
              text += `   ${source.text_content.substring(0, 200)}...\n\n`;
            }
          });
          return text;
        }
        return '📄 No documents found matching the search.';
        
      case 'find_documents':
        if (result.documents && result.documents.length > 0) {
          let text = `📄 Found ${result.documents.length} documents:\n\n`;
          result.documents.slice(0, 5).forEach((doc, index) => {
            text += `${index + 1}. **${doc.title || doc.original_filename || 'Untitled'}**\n`;
            if (doc.uploaded_at) {
              text += `   📅 ${new Date(doc.uploaded_at).toLocaleDateString()}\n`;
            }
          });
          return text;
        }
        return '📄 No documents found.';
        
      case 'count_documents':
        return `📊 Total documents: ${result.count}`;
        
      case 'list_collections':
        if (result.collections && result.collections.length > 0) {
          return `📂 Available collections (${result.collections.length}):\n• ${result.collections.join('\n• ')}`;
        }
        return '📂 No collections found.';
        
      case 'search_patients':
        if (result.patients && result.patients.length > 0) {
          let text = `👤 Found ${result.patients.length} patients:\n\n`;
          result.patients.slice(0, 3).forEach((patient, index) => {
            text += `**${index + 1}. ${patient.name}**\n`;
            if (patient.id) text += `   🆔 ID: ${patient.id}\n`;
            if (patient.birthDate) text += `   📅 DOB: ${patient.birthDate}\n\n`;
          });
          return text;
        }
        return '👤 No patients found.';
        
      case 'get_patient_observations':
        if (result.observations && result.observations.length > 0) {
          let text = `📊 Found ${result.observations.length} observations:\n\n`;
          result.observations.slice(0, 5).forEach((obs, index) => {
            text += `**${index + 1}. ${obs.code?.text || 'Unknown Test'}**\n`;
            if (obs.valueQuantity) {
              text += `   Value: ${obs.valueQuantity.value} ${obs.valueQuantity.unit}\n`;
            }
            if (obs.effectiveDateTime) {
              text += `   Date: ${new Date(obs.effectiveDateTime).toLocaleDateString()}\n\n`;
            }
          });
          return text;
        }
        return '📊 No observations found.';
        
      default:
        return `📋 Function Result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
    }
  },

  async testConnection() {
    try {
      const response = await this.sendMessageToOzwell("Hello");
      return { 
        status: 'healthy', 
        responseReceived: !!response
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error.message 
      };
    }
  }
};

// HTTP MCP Client for manual operations
export const mcpSdkClient = {
  async callMongoDbMcp(toolName, params) {
    try {
      console.log(`📡 Calling MongoDB HTTP MCP tool: ${toolName}`, params);
      
      const response = await HTTP.call('POST', `${MCP_SERVERS.mongodb}/tools/${toolName}`, {
        headers: { 'Content-Type': 'application/json' },
        data: params,
        timeout: 30000
      });
      
      if (response.data && response.data.success) {
        return response.data.result;
      } else {
        throw new Error(response.data?.error || 'MongoDB tool execution failed');
      }
    } catch (error) {
      console.error(`❌ MongoDB MCP error (${toolName}):`, error);
      throw new Meteor.Error("mcp-mongo-error", `MongoDB MCP Error: ${error.message}`);
    }
  },

  async callElasticsearchMcp(toolName, params) {
    try {
      console.log(`📡 Calling Elasticsearch HTTP MCP tool: ${toolName}`, params);
      
      const response = await HTTP.call('POST', `${MCP_SERVERS.elasticsearch}/tools/${toolName}`, {
        headers: { 'Content-Type': 'application/json' },
        data: params,
        timeout: 30000
      });
      
      if (response.data && response.data.success) {
        return response.data.result;
      } else {
        throw new Error(response.data?.error || 'Elasticsearch tool execution failed');
      }
    } catch (error) {
      console.error(`❌ Elasticsearch MCP error (${toolName}):`, error);
      throw new Meteor.Error("mcp-elasticsearch-error", `Elasticsearch MCP Error: ${error.message}`);
    }
  },

  async callFhirMcp(toolName, params) {
    try {
      console.log(`📡 Calling FHIR HTTP MCP tool: ${toolName}`, params);
      
      const response = await HTTP.call('POST', `${MCP_SERVERS.fhir}/tools/${toolName}`, {
        headers: { 'Content-Type': 'application/json' },
        data: params,
        timeout: 30000
      });
      
      if (response.data && response.data.success) {
        return response.data.result;
      } else {
        throw new Error(response.data?.error || 'FHIR tool execution failed');
      }
    } catch (error) {
      console.error(`❌ FHIR MCP error (${toolName}):`, error);
      throw new Meteor.Error("mcp-fhir-error", `FHIR MCP Error: ${error.message}`);
    }
  },

  getSystemStatus() {
    return { 
      timestamp: new Date(), 
      transport: 'http', 
      servers: MCP_SERVERS 
    };
  },

  async initialize() {
    console.log('🚀 HTTP MCP client initialized');
    console.log(`📍 Server URLs: ${Object.values(MCP_SERVERS).join(', ')}`);
  },

  async cleanup() {
    console.log('🛑 HTTP MCP client cleanup completed');
  }
};

// Helper functions for backward compatibility
export function cleanResponseText(responseText) {
  return responseText;
}

export async function executeToolsFromResponse(ozwellResponse) {
  return ozwellResponse;
}

export function createToolAwareSystemPrompt() {
  return "";
}

// Initialize HTTP MCP client
if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      console.log('🚀 Initializing HTTP MCP client...');
      await mcpSdkClient.initialize();
    } catch (error) {
      console.error('❌ HTTP MCP initialization failed:', error);
    }
  });
}