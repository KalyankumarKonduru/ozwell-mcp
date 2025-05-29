// imports/mcp/client.js - Enhanced version based on your current stable code

import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";
import { Messages } from "../api/messages.js";
import { spawn } from 'child_process';
import path from 'path';

const OZWELL_API_URL = Meteor.settings.private?.OZWELL_API_URL;
const OZWELL_API_KEY = Meteor.settings.private?.OZWELL_API_KEY;

// Get the project root directory
function getProjectRoot() {
  if (Meteor.isServer) {
    const cwd = process.cwd();
    
    // Check if we're in a Meteor build directory
    if (cwd.includes('.meteor/local/build')) {
      // Go up to find the project root
      const parts = cwd.split(path.sep);
      const meteorIndex = parts.findIndex(part => part === '.meteor');
      if (meteorIndex > 0) {
        return parts.slice(0, meteorIndex).join(path.sep);
      }
    }
    
    return cwd;
  }
  return process.cwd();
}

// Request ID counter for MCP protocol
let requestIdCounter = 0;

export const mcpOzwellClient = {
  async sendMessageToOzwell(userQuery, context = {}) {
    if (!OZWELL_API_URL || !OZWELL_API_KEY) {
      console.error("Ozwell API URL or Key is not configured in settings.json");
      throw new Meteor.Error("config-error", "Ozwell LLM service is not configured.");
    }
    if (Meteor.isServer) {
      try {
        console.log(`Sending query to Ozwell LLM: ${userQuery.substring(0, 100)}...`);
        
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
        
        return processResponse(response.data);
      } catch (error) {
        console.error("Error calling Ozwell LLM:", error.response ? error.response.data : error.message);
        throw new Meteor.Error("ozwell-api-error", `Failed to get response from Ozwell LLM: ${error.message}`);
      }
    }
    return null; 
  },

  // Health check method
  async testConnection() {
    try {
      const response = await this.sendMessageToOzwell("Health check");
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

// Enhanced MCP SDK Process Management
class McpSdkClient {
  constructor(serverName, serverFileName) {
    this.serverName = serverName;
    this.serverFileName = serverFileName;
    this.process = null;
    this.pendingRequests = new Map();
    this.isConnected = false;
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 3;
    this.reconnectDelay = 2000; // 2 seconds
    this.isShuttingDown = false;
    this.lastError = null;
    this.connectionTime = null;
    this.requestCount = 0;
    this.responseCount = 0;
  }

  getServerPath() {
    const projectRoot = getProjectRoot();
    const serverPath = path.join(projectRoot, 'mcp-servers', this.serverFileName, 'server.js');
    console.log(`📁 ${this.serverName} server path: ${serverPath}`);
    return serverPath;
  }

  async connect() {
    if (this.isConnected || this.isConnecting || this.isShuttingDown) {
      console.log(`⏭️ ${this.serverName} connection skipped (connected: ${this.isConnected}, connecting: ${this.isConnecting})`);
      return;
    }

    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      const error = new Error(`${this.serverName} MCP server failed to connect after ${this.maxConnectionAttempts} attempts`);
      this.lastError = error;
      throw error;
    }

    this.isConnecting = true;
    this.connectionAttempts++;

    return new Promise((resolve, reject) => {
      try {
        console.log(`🚀 Starting ${this.serverName} MCP SDK server (attempt ${this.connectionAttempts}/${this.maxConnectionAttempts})...`);
        
        const serverPath = this.getServerPath();
        
        // Check if server file exists
        const fs = require('fs');
        if (!fs.existsSync(serverPath)) {
          const error = new Error(`${this.serverName} server file not found: ${serverPath}`);
          this.lastError = error;
          this.isConnecting = false;
          reject(error);
          return;
        }
        
        this.process = spawn('node', [serverPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.dirname(serverPath),
          env: { ...process.env },
          detached: false // Important: don't detach the process
        });

        // Set up process event handlers
        this.process.on('error', (error) => {
          console.error(`❌ ${this.serverName} MCP process error:`, error);
          this.lastError = error;
          this.handleProcessExit();
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(error);
          }
        });

        this.process.on('exit', (code, signal) => {
          console.log(`🛑 ${this.serverName} MCP process exited with code ${code}, signal ${signal}`);
          this.handleProcessExit();
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new Error(`Process exited during connection (code: ${code})`));
          }
        });

        this.process.on('close', (code, signal) => {
          console.log(`🔒 ${this.serverName} MCP process closed with code ${code}, signal ${signal}`);
          this.handleProcessExit();
        });

        // Handle stderr for logging
        this.process.stderr.on('data', (data) => {
          const message = data.toString();
          console.log(`📝 ${this.serverName} MCP: ${message.trim()}`);
          
          // Check for successful connection
          if (message.includes('Listening on stdio') && !this.isConnected) {
            setTimeout(() => {
              this.initializeServer().then(() => {
                this.isConnecting = false;
                this.connectionAttempts = 0; // Reset on successful connection
                this.connectionTime = new Date();
                console.log(`✅ ${this.serverName} MCP SDK server fully connected`);
                resolve();
              }).catch((error) => {
                this.isConnecting = false;
                this.lastError = error;
                reject(error);
              });
            }, 1000);
          }
          
          // Check for connection errors
          if (message.includes('Failed to start') || message.includes('connection failed') || message.includes('ECONNREFUSED')) {
            this.isConnecting = false;
            const error = new Error(`${this.serverName} server failed to start: ${message}`);
            this.lastError = error;
            reject(error);
          }
        });

        // Handle stdout for MCP protocol communication
        let buffer = '';
        this.process.stdout.on('data', (data) => {
          buffer += data.toString();
          
          const lines = buffer.split('\n');
          buffer = lines.pop();
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const response = JSON.parse(line);
                this.handleResponse(response);
              } catch (e) {
                // Ignore non-JSON lines
              }
            }
          }
        });

        // Set a timeout for connection
        setTimeout(() => {
          if (this.isConnecting && !this.isConnected) {
            this.isConnecting = false;
            const error = new Error(`${this.serverName} connection timeout (10s)`);
            this.lastError = error;
            reject(error);
          }
        }, 10000); // 10 second timeout

      } catch (error) {
        this.isConnecting = false;
        this.lastError = error;
        reject(error);
      }
    });
  }

  handleProcessExit() {
    this.isConnected = false;
    this.isConnecting = false;
    this.process = null;
    this.connectionTime = null;
    
    // Clear any pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error(`${this.serverName} process exited`));
    }
    this.pendingRequests.clear();
  }

  async initializeServer() {
    try {
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'ozwell-mcp-chat', version: '1.0.0' }
      });
      
      this.isConnected = true;
      console.log(`✅ ${this.serverName} MCP SDK server initialized`);
    } catch (error) {
      console.error(`❌ Failed to initialize ${this.serverName} MCP server:`, error);
      this.lastError = error;
      throw error;
    }
  }

  async sendRequest(method, params) {
    if (!this.isConnected) {
      console.log(`🔄 ${this.serverName} not connected, attempting connection...`);
      await this.connect();
    }

    if (!this.process) {
      const error = new Error(`${this.serverName} process not available`);
      this.lastError = error;
      throw error;
    }

    return new Promise((resolve, reject) => {
      const id = ++requestIdCounter;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject, timestamp: Date.now() });
      this.requestCount++;

      try {
        const requestLine = JSON.stringify(request) + '\n';
        this.process.stdin.write(requestLine);
        console.log(`📤 ${this.serverName} request sent: ${method} (ID: ${id})`);
      } catch (error) {
        this.pendingRequests.delete(id);
        this.lastError = error;
        reject(error);
        return;
      }

      // Set timeout for the request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          const error = new Error(`${this.serverName} MCP request timeout (15s): ${method}`);
          this.lastError = error;
          reject(error);
        }
      }, 15000); // 15 second timeout
    });
  }

  handleResponse(response) {
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject, timestamp } = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);
      this.responseCount++;

      const duration = Date.now() - timestamp;
      console.log(`📥 ${this.serverName} response received (ID: ${response.id}, ${duration}ms)`);

      if (response.error) {
        const error = new Error(response.error.message || 'MCP error');
        this.lastError = error;
        reject(error);
      } else {
        resolve(response.result);
      }
    }
  }

  async listTools() {
    return this.sendRequest('tools/list', {});
  }

  async callTool(name, args) {
    console.log(`🔧 ${this.serverName} calling tool: ${name}`);
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  getStatus() {
    return {
      serverName: this.serverName,
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      connectionAttempts: this.connectionAttempts,
      connectionTime: this.connectionTime,
      requestCount: this.requestCount,
      responseCount: this.responseCount,
      pendingRequests: this.pendingRequests.size,
      lastError: this.lastError?.message,
      processRunning: !!this.process && !this.process.killed
    };
  }

  async disconnect() {
    console.log(`🛑 Disconnecting ${this.serverName} MCP server...`);
    this.isShuttingDown = true;
    
    if (this.process) {
      try {
        // Gracefully close stdin first
        this.process.stdin.end();
        
        // Give it a moment to close gracefully
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            console.log(`🔫 Terminating ${this.serverName} process...`);
            this.process.kill('SIGTERM');
            
            // Force kill if it doesn't close
            setTimeout(() => {
              if (this.process && !this.process.killed) {
                console.log(`💀 Force killing ${this.serverName} process...`);
                this.process.kill('SIGKILL');
              }
            }, 2000);
          }
        }, 1000);
      } catch (error) {
        console.error(`Error disconnecting ${this.serverName}:`, error);
      }
      
      this.process = null;
    }
    
    this.isConnected = false;
    this.isConnecting = false;
  }
}

// Create MCP SDK clients
const mongoMcpClient = new McpSdkClient('MongoDB', 'mongodb-server');
const elasticsearchMcpClient = new McpSdkClient('Elasticsearch', 'elasticsearch-server');
const fhirMcpClient = new McpSdkClient('FHIR', 'fhir-server');

export const mcpSdkClient = {
  async callMongoDbMcp(toolName, params) {
    try {
      console.log(`📡 Calling MongoDB MCP SDK tool: ${toolName}`, params);
      const result = await mongoMcpClient.callTool(toolName, params);
      
      if (result && result.content && result.content[0] && result.content[0].text) {
        try {
          return JSON.parse(result.content[0].text);
        } catch (e) {
          return result.content[0].text;
        }
      }
      
      return result;
    } catch (error) {
      console.error(`❌ MongoDB MCP SDK error (${toolName}):`, error);
      throw new Meteor.Error("mcp-mongo-sdk-error", `MongoDB MCP SDK Error: ${error.message}`);
    }
  },

  async callElasticsearchMcp(toolName, params) {
    try {
      console.log(`📡 Calling Elasticsearch MCP SDK tool: ${toolName}`, params);
      const result = await elasticsearchMcpClient.callTool(toolName, params);
      
      if (result && result.content && result.content[0] && result.content[0].text) {
        try {
          return JSON.parse(result.content[0].text);
        } catch (e) {
          return result.content[0].text;
        }
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Elasticsearch MCP SDK error (${toolName}):`, error);
      throw new Meteor.Error("mcp-es-sdk-error", `Elasticsearch MCP SDK Error: ${error.message}`);
    }
  },

  async checkMongoDbMcpHealth() {
    try {
      const tools = await mongoMcpClient.listTools();
      const status = mongoMcpClient.getStatus();
      return { 
        status: 'healthy', 
        service: 'mongodb-mcp-sdk',
        toolsAvailable: tools?.tools?.length || 0,
        ...status
      };
    } catch (error) {
      console.error("MongoDB MCP SDK health check failed:", error);
      const status = mongoMcpClient.getStatus();
      return { 
        status: 'unhealthy', 
        error: error.message,
        ...status
      };
    }
  },

  async checkElasticsearchMcpHealth() {
    try {
      const tools = await elasticsearchMcpClient.listTools();
      const status = elasticsearchMcpClient.getStatus();
      return { 
        status: 'healthy', 
        service: 'elasticsearch-mcp-sdk',
        toolsAvailable: tools?.tools?.length || 0,
        ...status
      };
    } catch (error) {
      console.error("Elasticsearch MCP SDK health check failed:", error);
      const status = elasticsearchMcpClient.getStatus();
      return { 
        status: 'unhealthy', 
        error: error.message,
        ...status
      };
    }
  },

  getSystemStatus() {
    return {
      timestamp: new Date(),
      mongodb: mongoMcpClient.getStatus(),
      elasticsearch: elasticsearchMcpClient.getStatus(),
      projectRoot: getProjectRoot()
    };
  },

  async callFhirMcp(toolName, params) {
    try {
      console.log(`📡 Calling FHIR MCP SDK tool: ${toolName}`, params);
      const result = await fhirMcpClient.callTool(toolName, params);
      
      if (result && result.content && result.content[0] && result.content[0].text) {
        try {
          return JSON.parse(result.content[0].text);
        } catch (e) {
          return result.content[0].text;
        }
      }
      
      return result;
    } catch (error) {
      console.error(`❌ FHIR MCP SDK error (${toolName}):`, error);
      throw new Meteor.Error("mcp-fhir-sdk-error", `FHIR MCP SDK Error: ${error.message}`);
    }
  },

  async checkFhirMcpHealth() {
    try {
      await fhirMcpClient.listTools();
      return { status: 'healthy', service: 'fhir-mcp-sdk' };
    } catch (error) {
      console.error("FHIR MCP SDK health check failed:", error);
      return { status: 'unhealthy', error: error.message };
    }
  },

  async initialize() {
    try {
      console.log(`📁 Project root detected: ${getProjectRoot()}`);
      
      // Initialize servers sequentially to avoid resource conflicts
      console.log('🔄 Initializing MongoDB MCP SDK server...');
      await mongoMcpClient.connect();
      
      console.log('🔄 Initializing Elasticsearch MCP SDK server...');
      await elasticsearchMcpClient.connect();
      
      console.log('🔄 Initializing FHIR MCP SDK server...');
      await fhirMcpClient.connect();
      
      console.log('✅ All MCP SDK servers initialized');
    } catch (error) {
      console.error('❌ Failed to initialize MCP SDK servers:', error);
      throw error;
    }
  },

  async cleanup() {
    console.log('🛑 Cleaning up MCP SDK servers...');
    
    await Promise.all([
      mongoMcpClient.disconnect(),
      elasticsearchMcpClient.disconnect(),
      fhirMcpClient.disconnect()
    ]);
    
    console.log('✅ All MCP SDK servers disconnected');
  }
};

// Note: createToolAwareSystemPrompt() removed as discussed
// If Ozwell AI returns structured responses with intent/action/parameters,
// we don't need to instruct it via system prompts
export function createToolAwareSystemPrompt() {
  return `
You have access to database tools via MCP SDK servers for Elasticsearch, MongoDB, and FHIR EHR systems. 
If the user's request requires retrieving, searching, or manipulating data, you MUST include tool execution instructions in your response.

When you determine a database tool should be used, ALWAYS format your response EXACTLY like this:
1. First, give a natural language response to the user's question
2. Then include a JSON block with tool execution instructions in this format:

\`\`\`json
{
  "target": "fhir",
  "tool": "search_patients",
  "params": {
    "family": "Smith",
    "given": "John"
  }
}
\`\`\`

Available systems and tools:
- **Elasticsearch**: search_documents, vector_search_documents, index_document, get_document, update_document, delete_document
- **MongoDB**: find_documents, insert_document, update_documents, delete_documents, count_documents, list_collections
- **FHIR EHR**: search_patients, get_patient, get_patient_observations, get_patient_conditions, get_patient_medications, get_patient_encounters, search_observations, get_fhir_capability, fhir_search, create_patient

Use FHIR tools for:
- Patient searches and demographic information
- Medical records, conditions, diagnoses
- Medications and prescriptions
- Lab results and vital signs
- Clinical encounters and visits
- Healthcare provider information

The system will automatically execute your tool instructions via MCP SDK servers.
`;
}
export function cleanResponseText(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return responseText;
  }
  
  let cleaned = responseText.replace(/```json[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"target"[\s\S]*?"tool"[\s\S]*?"params"[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();
  
  return cleaned || responseText;
}

function processResponse(data) {
  if (!data) {
    throw new Meteor.Error("api-response-error", "The API returned an empty response.");
  }
  
  let responseText = "";
  
  if (typeof data === 'string') {
    responseText = data;
  } else if (typeof data === 'object') {
    responseText = data.answer || 
                  data.text || 
                  data.content || 
                  data.message?.content ||
                  data.choices?.[0]?.message?.content ||
                  data.choices?.[0]?.text ||
                  data.response ||
                  data.completion ||
                  JSON.stringify(data);
  }
  
  return {
    answer: responseText,
    responseText: responseText
  };
}

export async function executeToolsFromResponse(ozwellResponse) {
  if (!ozwellResponse) {
    return null;
  }
  
  // Extract instructions from the response
  let instructions = null;
  
  if (ozwellResponse.choices && ozwellResponse.choices.length > 0) {
    const content = ozwellResponse.choices[0].message?.content;
    if (content) {
      instructions = extractInstructionsFromText(content);
    }
  }
  
  if (!instructions && (ozwellResponse.answer || ozwellResponse.responseText)) {
    const responseText = ozwellResponse.answer || ozwellResponse.responseText;
    instructions = extractInstructionsFromText(responseText);
  }
  
  if (!instructions) {
    return ozwellResponse;
  }
  
  try {
    const target = (instructions.target || "").toLowerCase();
    const tool = instructions.tool;
    const params = instructions.params || {};
    
    if (!target || !tool) {
      return ozwellResponse;
    }
    
    await Messages.insertAsync({
      text: `🔧 Executing ${target} tool via MCP SDK server: ${tool}`,
      createdAt: new Date(),
      userId: "system-auto",
      owner: "MCP SDK Client",
      type: "system-info",
    });
    
    let result;
    if (target === "elasticsearch" || target === "es") {
      result = await Meteor.callAsync('mcp.callElasticsearchSdk', tool, params);
    } else if (target === "mongodb" || target === "mongo" || target === "db") {
      result = await Meteor.callAsync('mcp.callMongoSdk', tool, params);
    } else {
      throw new Error(`Unknown target system: ${target}`);
    }
    
    // Enhanced result display with better formatting
    if (result) {
      let displayText;
      if (typeof result === 'object') {
        // Format results based on operation type
        if (result.success && result.documents) {
          // MongoDB find results
          displayText = `📄 Found ${result.documents.length} documents in collection '${result.collection}'`;
          if (result.documents.length > 0) {
            displayText += `\n\nFirst few results:\n`;
            result.documents.slice(0, 3).forEach((doc, index) => {
              displayText += `\n${index + 1}. ${doc.title || doc.original_filename || doc._id}`;
              if (doc.uploaded_at) displayText += ` (${new Date(doc.uploaded_at).toLocaleDateString()})`;
            });
          }
        } else if (result.success && result.hits) {
          // Elasticsearch search results
          displayText = `🔍 Found ${result.total || result.hits.length} matching documents`;
          if (result.hits.length > 0) {
            displayText += `\n\nTop results:\n`;
            result.hits.slice(0, 3).forEach((hit, index) => {
              const source = hit._source || hit.source || {};
              displayText += `\n${index + 1}. ${source.title || 'Untitled Document'}`;
              if (source.uploaded_at) displayText += ` (${new Date(source.uploaded_at).toLocaleDateString()})`;
              if (hit._score) displayText += ` - Relevance: ${hit._score.toFixed(2)}`;
            });
          }
        } else if (result.collections) {
          // List collections result
          displayText = `📂 Available collections (${result.collections.length}):\n${result.collections.join(', ')}`;
        } else if (result.count !== undefined) {
          // Count operation result
          displayText = `📊 Count result: ${result.count} documents`;
        } else {
          // Fallback to JSON display
          displayText = JSON.stringify(result, null, 2);
        }
      } else {
        displayText = String(result);
      }
      
      await Messages.insertAsync({
        text: displayText,
        createdAt: new Date(),
        userId: `system-${target}`,
        owner: `${target.charAt(0).toUpperCase() + target.slice(1)} MCP SDK Server`,
        type: "mcp-response",
      });
    }
    
    return { ...ozwellResponse, toolExecutionResult: result };
  } catch (error) {
    console.error("❌ Error executing MCP SDK tool:", error);
    
    await Messages.insertAsync({
      text: `❌ Error executing MCP SDK tool: ${error.reason || error.message}`,
      createdAt: new Date(),
      userId: "system-error",
      owner: "MCP SDK Client",
      type: "error",
    });
    
    return { ...ozwellResponse, toolExecutionError: error.reason || error.message };
  }
}

function extractInstructionsFromText(text) {
  if (!text) return null;
  
  const jsonBlockRegex = /```(?:json)?\s*({[\s\S]*?})\s*```/;
  const match = text.match(jsonBlockRegex);
  
  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.target && parsed.tool) {
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse JSON block:", e);
    }
  }
  
  return null;
}

// Initialize MCP SDK servers when the module loads (with better error handling)
if (Meteor.isServer) {
  let initialized = false;
  
  Meteor.startup(async () => {
    if (initialized) return;
    initialized = true;
    
    try {
      console.log('🚀 Initializing MCP SDK servers...');
      await mcpSdkClient.initialize();
      console.log('✅ MCP SDK servers initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize MCP SDK servers:', error);
      console.error('💡 MCP servers will be started on first use');
    }
  });

  // Enhanced cleanup with better process management
  const cleanup = async () => {
    if (initialized) {
      console.log('🛑 Application shutting down, cleaning up MCP SDK servers...');
      try {
        await mcpSdkClient.cleanup();
        console.log('✅ MCP SDK servers cleanup completed');
      } catch (error) {
        console.error('❌ Error during MCP SDK cleanup:', error);
      }
    }
  };

  // Handle various shutdown signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('SIGUSR2', cleanup); // For nodemon
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    cleanup().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup().then(() => process.exit(1));
  });
  
  // Handle process exit
  process.on('exit', (code) => {
    console.log(`🛑 Process exiting with code ${code}, MCP servers should be cleaned up`);
  });
}