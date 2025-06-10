import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";
import { spawn } from 'child_process';
import path from 'path';

const OZWELL_API_URL = Meteor.settings.private?.OZWELL_API_URL;
const OZWELL_API_KEY = Meteor.settings.private?.OZWELL_API_KEY;

function getProjectRoot() {
  if (Meteor.isServer) {
    const cwd = process.cwd();
    if (cwd.includes('.meteor/local/build')) {
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

let requestIdCounter = 0;

export const mcpOzwellClient = {
  async sendMessageToOzwell(userQuery, availableTools = []) {
    if (!OZWELL_API_URL || !OZWELL_API_KEY) {
      throw new Meteor.Error("config-error", "Ozwell LLM service is not configured.");
    }
    
    if (Meteor.isServer) {
      try {
        const requestData = {
          prompt: userQuery,
          max_tokens: 1000,
          temperature: 0.7,
          tools: availableTools,        // ← OpenAI format tools
          tool_choice: "auto"           // ← Let Ozwell decide when to use tools
        };
        
        const response = await HTTP.call("POST", `${OZWELL_API_URL}/v1/completion`, {
          headers: {
            "Authorization": `Bearer ${OZWELL_API_KEY}`,
            "Content-Type": "application/json",
          },
          data: requestData,
          timeout: 30000,
        });
        
        return processResponse(response.data);
      } catch (error) {
        throw new Meteor.Error("ozwell-api-error", `Failed to get response from Ozwell LLM: ${error.message}`);
      }
    }
    return null; 
  }
};

class McpSdkClient {
  constructor(serverName, serverFileName) {
    this.serverName = serverName;
    this.serverFileName = serverFileName;
    this.process = null;
    this.pendingRequests = new Map();
    this.isConnected = false;
    this.isConnecting = false;
  }

  getServerPath() {
    const projectRoot = getProjectRoot();
    return path.join(projectRoot, 'mcp-servers', this.serverFileName, 'server.js');
  }

  async connect() {
    if (this.isConnected || this.isConnecting) return;

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        const serverPath = this.getServerPath();
        
        const fs = require('fs');
        if (!fs.existsSync(serverPath)) {
          this.isConnecting = false;
          reject(new Error(`${this.serverName} server file not found: ${serverPath}`));
          return;
        }
        
        this.process = spawn('node', [serverPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.dirname(serverPath),
          env: { ...process.env },
          detached: false
        });

        this.process.on('error', (error) => {
          this.handleProcessExit();
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(error);
          }
        });

        this.process.on('exit', () => {
          this.handleProcessExit();
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new Error(`Process exited during connection`));
          }
        });

        this.process.stderr.on('data', (data) => {
          const message = data.toString();
          
          if (message.includes('Listening on stdio') && !this.isConnected) {
            setTimeout(() => {
              this.initializeServer().then(() => {
                this.isConnecting = false;
                resolve();
              }).catch((error) => {
                this.isConnecting = false;
                reject(error);
              });
            }, 1000);
          }
          
          if (message.includes('Failed to start') || message.includes('connection failed')) {
            this.isConnecting = false;
            reject(new Error(`${this.serverName} server failed to start`));
          }
        });

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

        setTimeout(() => {
          if (this.isConnecting && !this.isConnected) {
            this.isConnecting = false;
            reject(new Error(`${this.serverName} connection timeout`));
          }
        }, 10000);

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
    
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error(`${this.serverName} process exited`));
    }
    this.pendingRequests.clear();
  }

  async initializeServer() {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'ozwell-mcp-chat', version: '1.0.0' }
    });
    
    this.isConnected = true;
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

      this.pendingRequests.set(id, { resolve, reject, timestamp: Date.now() });

      try {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
        return;
      }

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`${this.serverName} MCP request timeout`));
        }
      }, 15000);
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
    if (this.process) {
      try {
        this.process.stdin.end();
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
          }
        }, 1000);
      } catch (error) {
        // Ignore cleanup errors
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
  async getAvailableToolsForOzwell() {
    try {
      const [mongoTools, esTools, fhirTools] = await Promise.all([
        mongoMcpClient.listTools().catch(() => ({ tools: [] })),
        elasticsearchMcpClient.listTools().catch(() => ({ tools: [] })),
        fhirMcpClient.listTools().catch(() => ({ tools: [] }))
      ]);

      const toolsForOzwell = [];

      if (mongoTools.tools) {
        mongoTools.tools.forEach(tool => {
          toolsForOzwell.push({
            type: "function",
            function: {
              name: `mongodb_${tool.name}`,
              description: `[MongoDB] ${tool.description}`,
              parameters: tool.inputSchema
            }
          });
        });
      }

      if (esTools.tools) {
        esTools.tools.forEach(tool => {
          toolsForOzwell.push({
            type: "function", 
            function: {
              name: `elasticsearch_${tool.name}`,
              description: `[Elasticsearch] ${tool.description}`,
              parameters: tool.inputSchema
            }
          });
        });
      }

      if (fhirTools.tools) {
        fhirTools.tools.forEach(tool => {
          toolsForOzwell.push({
            type: "function",
            function: {
              name: `fhir_${tool.name}`,
              description: `[FHIR EHR] ${tool.description}`,
              parameters: tool.inputSchema
            }
          });
        });
      }

      return toolsForOzwell;
    } catch (error) {
      return [];
    }
  },

  async executeToolCall(toolCall) {
    try {
      const { name, arguments: args } = toolCall.function;
      let result;
      
      if (name.startsWith('mongodb_')) {
        const actualToolName = name.replace('mongodb_', '');
        result = await this.callMongoDbMcp(actualToolName, args);
      } else if (name.startsWith('elasticsearch_')) {
        const actualToolName = name.replace('elasticsearch_', '');
        result = await this.callElasticsearchMcp(actualToolName, args);
      } else if (name.startsWith('fhir_')) {
        const actualToolName = name.replace('fhir_', '');
        result = await this.callFhirMcp(actualToolName, args);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      return {
        tool_call_id: toolCall.id,
        role: "tool",
        name: name,
        content: JSON.stringify(result)
      };
    } catch (error) {
      return {
        tool_call_id: toolCall.id,
        role: "tool",
        name: toolCall.function.name,
        content: JSON.stringify({ error: error.message })
      };
    }
  },

  async callMongoDbMcp(toolName, params) {
    const result = await mongoMcpClient.callTool(toolName, params);
    
    if (result && result.content && result.content[0] && result.content[0].text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch (e) {
        return result.content[0].text;
      }
    }
    
    return result;
  },

  async callElasticsearchMcp(toolName, params) {
    const result = await elasticsearchMcpClient.callTool(toolName, params);
    
    if (result && result.content && result.content[0] && result.content[0].text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch (e) {
        return result.content[0].text;
      }
    }
    
    return result;
  },

  async callFhirMcp(toolName, params) {
    const result = await fhirMcpClient.callTool(toolName, params);
    
    if (result && result.content && result.content[0] && result.content[0].text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch (e) {
        return result.content[0].text;
      }
    }
    
    return result;
  },

  async initialize() {
    await Promise.all([
      mongoMcpClient.connect(),
      elasticsearchMcpClient.connect(),
      fhirMcpClient.connect()
    ]);
  },

  async cleanup() {
    await Promise.all([
      mongoMcpClient.disconnect(),
      elasticsearchMcpClient.disconnect(),
      fhirMcpClient.disconnect()
    ]);
  }
};

function processResponse(data) {
  if (!data) {
    throw new Meteor.Error("api-response-error", "The API returned an empty response.");
  }
  
  let responseText = "";
  let toolCalls = [];
  
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
    
    if (data.tool_calls && Array.isArray(data.tool_calls)) {
      toolCalls = data.tool_calls;
    } else if (data.choices?.[0]?.message?.tool_calls) {
      toolCalls = data.choices[0].message.tool_calls;
    } else if (data.message?.tool_calls) {
      toolCalls = data.message.tool_calls;
    }
  }
  
  return {
    answer: responseText,
    responseText: responseText,
    tool_calls: toolCalls
  };
}

if (Meteor.isServer) {
  let initialized = false;
  
  Meteor.startup(async () => {
    if (initialized) return;
    initialized = true;
    
    try {
      await mcpSdkClient.initialize();
    } catch (error) {
      // MCP servers will be started on first use
    }
  });

  const cleanup = async () => {
    if (initialized) {
      try {
        await mcpSdkClient.cleanup();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('SIGUSR2', cleanup);
  
  process.on('uncaughtException', (error) => {
    cleanup().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    cleanup().then(() => process.exit(1));
  });
  
  process.on('exit', () => {
  });
}