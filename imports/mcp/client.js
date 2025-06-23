// imports/mcp/client.js - Debug Version

import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_KEY = Meteor.settings.private?.CLAUDE_API_KEY;
const CLAUDE_MODEL = "claude-sonnet-4-20250514"; // Use stable model first

// Debug API key on startup
if (Meteor.isServer) {
  Meteor.startup(() => {
    console.log("🔍 DEBUG: API Key Check");
    console.log("   Settings.private exists:", !!Meteor.settings.private);
    console.log("   CLAUDE_API_KEY exists:", !!CLAUDE_API_KEY);
    console.log("   API Key length:", CLAUDE_API_KEY?.length || 0);
    console.log("   API Key starts with:", CLAUDE_API_KEY?.substring(0, 10) || "undefined");
    console.log("   Full settings structure:", Object.keys(Meteor.settings.private || {}));
  });
}

export const mcpClaudeClient = {
  async sendMessageToClaude(userQuery, includeTools = false) { // Default to false for testing
    // Enhanced API key debugging
    console.log("🔍 DEBUG: sendMessageToClaude called");
    console.log("   CLAUDE_API_KEY:", CLAUDE_API_KEY ? `${CLAUDE_API_KEY.substring(0, 15)}...` : "UNDEFINED");
    console.log("   Key length:", CLAUDE_API_KEY?.length);
    console.log("   Key type:", typeof CLAUDE_API_KEY);
    
    if (Meteor.isServer) {
      try {
        console.log(`📤 Sending to Claude: ${userQuery.substring(0, 50)}...`);
        
        const response = await this.callClaudeBasic(userQuery);
        return response;
        
      } catch (error) {
        console.error("❌ Claude API Error Details:");
        console.error("   Error type:", error.constructor.name);
        console.error("   Error message:", error.message);
        
        if (error.response) {
          console.error("   HTTP Status:", error.response.statusCode);
          console.error("   Response:", error.response.content);
          console.error("   Headers:", error.response.headers);
        }
        
        throw new Meteor.Error("claude-api-error", `Claude API failed: ${error.message}`);
      }
    }
    return null; 
  },

  async callClaudeBasic(userQuery) {
    const requestData = {
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: userQuery
        }
      ]
    };

    const headers = {
      "Authorization": `Bearer ${CLAUDE_API_KEY}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01"
    };
    
    console.log("🚀 Making basic Claude API request");
    console.log("   URL:", CLAUDE_API_URL);
    console.log("   Model:", CLAUDE_MODEL);
    console.log("   Auth header:", `Bearer ${CLAUDE_API_KEY.substring(0, 20)}...`);
    
    const response = await HTTP.call("POST", CLAUDE_API_URL, {
      headers,
      data: requestData,
      timeout: 30000,
    });
    
    console.log("✅ Response received from Claude");
    return this.processClaudeResponse(response.data);
  },

  processClaudeResponse(data) {
    if (!data || !data.content) {
      throw new Meteor.Error("api-response-error", "Empty response from Claude");
    }
    
    const responseText = data.content[0]?.text || "No text content";
    
    return {
      responseText,
      answer: responseText,
      usage: data.usage,
      mcpToolUses: [],
      mcpToolResults: [],
      stop_reason: data.stop_reason
    };
  },

  async testConnection() {
    try {
      console.log("🧪 Testing Claude connection...");
      const response = await this.sendMessageToClaude("Hello! Please respond with 'Connection test successful'.");
      
      return { 
        status: 'healthy', 
        responseReceived: !!response,
        response: response.responseText
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error.message 
      };
    }
  }
};

export const mcpSdkClient = {
  async initialize() {
    console.log('🚀 Initializing Claude client...');
    
    // Test the API key immediately
    try {
      const testResult = await mcpClaudeClient.testConnection();
      if (testResult.status === 'healthy') {
        console.log('✅ Claude API key is working!');
        console.log('   Response:', testResult.response);
      } else {
        console.error('❌ Claude API key test failed:', testResult.error);
      }
    } catch (error) {
      console.error('❌ Failed to test Claude API:', error.message);
    }
  },

  async cleanup() {
    console.log('🛑 Claude client cleanup completed');
  }
};

// Initialize and test immediately
if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      await mcpSdkClient.initialize();
    } catch (error) {
      console.error('❌ Claude client initialization failed:', error);
    }
  });
}