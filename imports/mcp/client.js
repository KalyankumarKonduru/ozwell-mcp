// imports/mcp/client.js - Stable version with better process management

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
  async sendMessageToOzwell(userQuery) {
    if (!OZWELL_API_URL || !OZWELL_API_KEY) {
      console.error("Ozwell API URL or Key is not configured in settings.json");
      throw new Meteor.Error("config-error", "Ozwell LLM service is not configured.");
    }
    if (Meteor.isServer) {
      try {
        console.log(`Sending query to Ozwell LLM: ${userQuery}`);
        
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
};

// Improved MCP SDK Process Management
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
  }

  getServerPath() {
    const projectRoot = getProjectRoot();
    const serverPath = path.join(projectRoot, 'mcp-servers', this.serverFileName, 'server.js');
    console.log(`📁 ${this.serverName} server path: ${serverPath}`);
    return serverPath;
  }

  async connect() {
    if (this.isConnected || this.isConnecting || this.isShuttingDown) {
      return;
    }

    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      throw new Error(`${this.serverName} MCP server failed to connect after ${this.maxConnectionAttempts} attempts`);
    }

    this.isConnecting = true;
    this.connectionAttempts++;

    return new Promise((resolve, reject) => {
      try {
        console.log(`🚀 Starting ${this.serverName} MCP SDK server (attempt ${this.connectionAttempts})...`);
        
        const serverPath = this.getServerPath();
        
        this.process = spawn('node', [serverPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.dirname(serverPath),
          env: { ...process.env },
          detached: false // Important: don't detach the process
        });

        // Set up process event handlers
        this.process.on('error', (error) => {
          console.error(`❌ ${this.serverName} MCP process error:`, error);
          this.handleProcessExit();
          reject(error);
        });

        this.process.on('exit', (code, signal) => {
          console.log(`🛑 ${this.serverName} MCP process exited with code ${code}, signal ${signal}`);
          this.handleProcessExit();
          if (!this.isConnected && this.isConnecting) {
            reject(new Error(`Process exited during connection`));
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
                resolve();
              }).catch((error) => {
                this.isConnecting = false;
                reject(error);
              });
            }, 1000);
          }
          
          // Check for connection errors
          if (message.includes('Failed to start') || message.includes('connection failed')) {
            this.isConnecting = false;
            reject(new Error(`${this.serverName} server failed to start`));
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
            reject(new Error(`${this.serverName} connection timeout`));
          }
        }, 10000); // 10 second timeout

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  handleProcessExit() {
    this.isConnected = false;
    this.isConnecting = false;
    this.process = null;
    
    // Clear any pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error(`${this.serverName} process exited`));
    }
    this.pendingRequests.clear();
  }

  async initializeServer() {
    try {
      await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'ozwell-mcp-chat', version: '1.0.0' }
      });
      
      this.isConnected = true;
      console.log(`✅ ${this.serverName} MCP SDK server connected and initialized`);
    } catch (error) {
      console.error(`❌ Failed to initialize ${this.serverName} MCP server:`, error);
      throw error;
    }
  }

  async sendRequest(method, params) {
    if (!this.isConnected) {
      await this.connect();
    }

    if (!this.process) {
      throw new Error(`${this.serverName} process not available`);
    }

    return new Promise((resolve, reject) => {
      const id = ++requestIdCounter;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      try {
        const requestLine = JSON.stringify(request) + '\n';
        this.process.stdin.write(requestLine);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
        return;
      }

      // Set timeout for the request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`${this.serverName} MCP request timeout`));
        }
      }, 15000); // 15 second timeout
    });
  }

  handleResponse(response) {
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        reject(new Error(response.error.message || 'MCP error'));
      } else {
        resolve(response.result);
      }
    }
  }

  async listTools() {
    return this.sendRequest('tools/list', {});
  }

  async callTool(name, args) {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  async disconnect() {
    this.isShuttingDown = true;
    
    if (this.process) {
      try {
        // Gracefully close stdin first
        this.process.stdin.end();
        
        // Give it a moment to close gracefully
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
            
            // Force kill if it doesn't close
            setTimeout(() => {
              if (this.process && !this.process.killed) {
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
      await mongoMcpClient.listTools();
      return { status: 'healthy', service: 'mongodb-mcp-sdk' };
    } catch (error) {
      console.error("MongoDB MCP SDK health check failed:", error);
      return { status: 'unhealthy', error: error.message };
    }
  },

  async checkElasticsearchMcpHealth() {
    try {
      await elasticsearchMcpClient.listTools();
      return { status: 'healthy', service: 'elasticsearch-mcp-sdk' };
    } catch (error) {
      console.error("Elasticsearch MCP SDK health check failed:", error);
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
      elasticsearchMcpClient.disconnect()
    ]);
    
    console.log('✅ All MCP SDK servers disconnected');
  }
};

// Rest of the file remains the same as before...
export function createToolAwareSystemPrompt() {
  return `
You have access to database tools via MCP SDK servers for both Elasticsearch and MongoDB. 
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

Available Elasticsearch tools: search_documents, vector_search_documents, index_document, get_document, update_document, delete_document
Available MongoDB tools: find_documents, insert_document, update_documents, delete_documents, count_documents, list_collections

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
    
    // Display results in chat
    if (result) {
      await Messages.insertAsync({
        text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
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

  // Enhanced cleanup
  const cleanup = async () => {
    if (initialized) {
      await mcpSdkClient.cleanup();
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  
  // Handle process exit
  process.on('exit', () => {
    console.log('🛑 Process exiting, MCP servers should be cleaned up');
  });
}