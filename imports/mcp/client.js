// imports/mcp/client.js - Robust Claude Client with Better Fallback

import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_KEY = Meteor.settings.private?.CLAUDE_API_KEY;
const CLAUDE_MODEL = "claude-opus-4-20250514";

// Local MCP Servers
const MCP_SERVERS = [
  {
    type: "url",
    url: "http://localhost:3000/mcp/mongodb/sse",
    name: "mongodb-server",
    tool_configuration: {
      enabled: true
    }
  },
  {
    type: "url",
    url: "http://localhost:3000/mcp/elasticsearch/sse", 
    name: "elasticsearch-server",
    tool_configuration: {
      enabled: true
    }
  },
  {
    type: "url",
    url: "http://localhost:3000/mcp/fhir/sse",
    name: "fhir-server", 
    tool_configuration: {
      enabled: true
    }
  }
];

export const mcpClaudeClient = {
  async sendMessageToClaude(userQuery, includeTools = true) {
    if (!CLAUDE_API_KEY) {
      throw new Meteor.Error("config-error", "Claude API Key is missing");
    }
    
    if (Meteor.isServer) {
      try {
        // Always try basic first to ensure connectivity
        const response = await this.callClaudeBasic(userQuery);
        return response;
        
      } catch (error) {
        console.error("Claude API Error:", error.message);
        throw new Meteor.Error("claude-api-error", `Claude API failed: ${error.message}`);
      }
    }
    return null; 
  },

  async callClaudeBasic(userQuery) {
    const requestData = {
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: userQuery
        }
      ]
    };

    const headers = {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    };
    
    const response = await HTTP.call("POST", CLAUDE_API_URL, {
      headers,
      data: requestData,
      timeout: 30000,
    });
    
    return this.processClaudeResponse(response.data);
  },

  async callClaudeWithMCP(userQuery) {
    const requestData = {
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: userQuery
        }
      ],
      mcp_servers: MCP_SERVERS
    };

    const headers = {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-beta": "mcp-client-2025-04-04"
    };
    
    const response = await HTTP.call("POST", CLAUDE_API_URL, {
      headers,
      data: requestData,
      timeout: 60000,
    });
    
    return this.processClaudeResponse(response.data);
  },

  processClaudeResponse(data) {
    if (!data || !data.content) {
      throw new Meteor.Error("api-response-error", "Empty response from Claude");
    }
    
    let responseText = "";
    let mcpToolUses = [];
    let mcpToolResults = [];
    
    for (const block of data.content) {
      switch (block.type) {
        case "text":
          responseText += block.text;
          break;
          
        case "mcp_tool_use":
          mcpToolUses.push({
            id: block.id,
            name: block.name,
            server_name: block.server_name,
            input: block.input
          });
          responseText += `\nUsing tool: ${block.name} from ${block.server_name}\n`;
          break;
          
        case "mcp_tool_result":
          mcpToolResults.push({
            tool_use_id: block.tool_use_id,
            is_error: block.is_error,
            content: block.content
          });
          
          if (block.is_error) {
            responseText += `\nTool error: ${JSON.stringify(block.content)}\n`;
          } else {
            responseText += `\nTool completed successfully\n`;
          }
          break;
      }
    }
    
    return {
      responseText: responseText.trim(),
      answer: responseText.trim(),
      usage: data.usage,
      mcpToolUses,
      mcpToolResults,
      stop_reason: data.stop_reason,
      model: data.model
    };
  },

  // Method to try MCP when user specifically requests tool access
  async sendMessageWithMCP(userQuery) {
    if (!CLAUDE_API_KEY) {
      throw new Meteor.Error("config-error", "Claude API Key is missing");
    }
    
    if (Meteor.isServer) {
      try {
        const response = await this.callClaudeWithMCP(userQuery);
        return response;
        
      } catch (error) {
        console.error("MCP request failed, falling back to basic:", error.message);
        
        // Fallback to basic if MCP fails
        try {
          const fallbackResponse = await this.callClaudeBasic(userQuery);
          // Add note about MCP unavailability
          fallbackResponse.responseText += "\n\n(Note: MCP tools are currently unavailable)";
          fallbackResponse.answer = fallbackResponse.responseText;
          return fallbackResponse;
        } catch (fallbackError) {
          throw new Meteor.Error("claude-api-error", `Claude API failed: ${fallbackError.message}`);
        }
      }
    }
    return null;
  }
};

export const mcpSdkClient = {
  getMCPServersInfo() {
    return {
      servers: MCP_SERVERS.map(server => ({
        name: server.name,
        url: server.url,
        enabled: server.tool_configuration?.enabled ?? true,
        type: "Local MCP Connector"
      })),
      total: MCP_SERVERS.length,
      transport: "Claude Native MCP Connector",
      model: CLAUDE_MODEL
    };
  },

  async initialize() {
    console.log('Initializing Claude MCP client...');
  },

  async cleanup() {
    console.log('Claude MCP client cleanup completed');
  }
};

if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      await mcpSdkClient.initialize();
    } catch (error) {
      console.error('Claude MCP initialization failed:', error);
    }
  });
}