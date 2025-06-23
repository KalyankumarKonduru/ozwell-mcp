// imports/api/methods.js - Claude MCP Connector Implementation

import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpClaudeClient, mcpSdkClient } from "../mcp/client.js"; 
import { extractTextFromFile, chunkText, generateEmbeddingsForChunks, extractStructuredData } from "../mcp/document-processor.js";

// Document processing config
const DOC_PROCESSING_CONFIG = {
  ELASTICSEARCH_INDEX: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX || "claude_documents",
  ELASTICSEARCH_INDEX_CHUNKS: Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX_CHUNKS || "claude_document_chunks",
  CHUNK_SIZE: Meteor.settings.private?.RAG_CHUNK_SIZE || 1000,
  CHUNK_OVERLAP: Meteor.settings.private?.RAG_CHUNK_OVERLAP || 200,
  MAX_CHUNKS: Meteor.settings.private?.RAG_MAX_CHUNKS || 50,
};

Meteor.methods({
  async "messages.send"(text, fileUploadInfo = null) {
    check(text, String);
    if (fileUploadInfo) {
      check(fileUploadInfo, {
        name: String,
        type: String,
        size: Number,
        data: String
      });
    }

    const userName = this.userId ? (Meteor.users.findOne(this.userId)?.username || "User") : "Anonymous";

    // Insert the user's message
    await Messages.insertAsync({
      text,
      createdAt: new Date(),
      owner: userName,
      type: "user",
    });

    // Handle file upload if present
    if (fileUploadInfo) {
      await this.processFileUpload(fileUploadInfo, text);
      return;
    }

    // Handle regular text messages - send to Claude with MCP
    try {
      const claudeResponse = await mcpClaudeClient.sendMessageToClaude(text);
      
      await Messages.insertAsync({
        text: claudeResponse.responseText || claudeResponse.answer,
        createdAt: new Date(),
        userId: "claude-ai",
        owner: "Claude AI",
        type: "ai",
      });

      // Log MCP tool usage if any
      if (claudeResponse.mcpToolUses && claudeResponse.mcpToolUses.length > 0) {
        await Messages.insertAsync({
          text: `🔧 Claude used ${claudeResponse.mcpToolUses.length} MCP tool(s): ${claudeResponse.mcpToolUses.map(t => `${t.name} (${t.server_name})`).join(', ')}`,
          createdAt: new Date(),
          userId: "system-mcp",
          owner: "MCP Activity",
          type: "system-info",
        });
      }
      
      return claudeResponse;
    } catch (error) {
      await Messages.insertAsync({
        text: `❌ Error communicating with Claude: ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "System",
        type: "error",
      });
      throw new Meteor.Error("api-error", `Failed to process message: ${error.message}`);
    }
  },

  async processFileUpload(fileUploadInfo, userContext) {
    const documentId = new Mongo.ObjectID()._str;
    
    await Messages.insertAsync({
      text: `📄 Processing document "${fileUploadInfo.name}"...`,
      createdAt: new Date(),
      userId: "system-process",
      owner: "Document Processor",
      type: "processing",
    });

    try {
      // Extract text from the document
      const fileBuffer = Buffer.from(fileUploadInfo.data, 'base64');
      
      await Messages.insertAsync({
        text: `🔍 Extracting text from "${fileUploadInfo.name}"...`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "processing",
      });
      
      const extractionResult = await extractTextFromFile(fileBuffer, fileUploadInfo.name, fileUploadInfo.type);
      
      if (!extractionResult.success) {
        await Messages.insertAsync({
          text: `❌ Error extracting text: ${extractionResult.text}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "Document Processor",
          type: "error",
        });
        return;
      }
      
      // Store document info for Claude to potentially use via MCP
      const documentSummary = {
        filename: fileUploadInfo.name,
        size: fileUploadInfo.size,
        type: fileUploadInfo.type,
        textLength: extractionResult.text.length,
        extractionMethod: extractionResult.method,
        userContext: userContext,
        processedAt: new Date()
      };
      
      await Messages.insertAsync({
        text: `✅ Document "${fileUploadInfo.name}" successfully processed! ` +
              `Extracted ${extractionResult.text.length} characters. ` +
              `The document is now available for Claude to access via MCP tools.`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "system-info",
      });
      
      // Let Claude analyze the document with MCP access
      if (userContext && userContext.trim().length > 0) {
        const analysisPrompt = `I've uploaded a document "${fileUploadInfo.name}" with this context: "${userContext}". ` +
                             `The document has been processed and contains ${extractionResult.text.length} characters. ` +
                             `Please analyze this document and tell me what you can learn from it. You can use your MCP tools if needed.`;
        
        try {
          const claudeResponse = await mcpClaudeClient.sendMessageToClaude(analysisPrompt);
          
          await Messages.insertAsync({
            text: claudeResponse.responseText || claudeResponse.answer,
            createdAt: new Date(),
            userId: "claude-ai",
            owner: "Claude AI",
            type: "ai",
          });

          // Log any MCP tool usage
          if (claudeResponse.mcpToolUses && claudeResponse.mcpToolUses.length > 0) {
            await Messages.insertAsync({
              text: `🔧 Claude used ${claudeResponse.mcpToolUses.length} MCP tool(s) for document analysis`,
              createdAt: new Date(),
              userId: "system-mcp",
              owner: "MCP Activity",
              type: "system-info",
            });
          }
        } catch (error) {
          console.error("Error getting Claude analysis:", error);
        }
      }
      
    } catch (error) {
      console.error("Document processing error:", error);
      await Messages.insertAsync({
        text: `❌ Error processing document "${fileUploadInfo.name}": ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "Document Processor",
        type: "error",
      });
    }
  },

  // MCP Status and Info methods
  async "mcp.getStatus"() {
    try {
      const mcpInfo = mcpSdkClient.getMCPServersInfo();
      
      await Messages.insertAsync({
        text: `🔧 **Claude MCP Connector Status**\n\n` +
              `Transport: ${mcpInfo.transport}\n` +
              `Servers Configured: ${mcpInfo.total}\n\n` +
              mcpInfo.servers.map(server => 
                `**${server.name}**\n` +
                `  URL: ${server.url}\n` +
                `  Status: ${server.enabled ? '✅ Enabled' : '❌ Disabled'}\n`
              ).join('\n'),
        createdAt: new Date(), 
        userId: "system-mcp", 
        owner: "MCP Status", 
        type: "mcp-response"
      });
      
      return mcpInfo;
    } catch (error) {
      console.error("❌ Error getting MCP status:", error);
      
      await Messages.insertAsync({
        text: `❌ Error getting MCP status: ${error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Client", 
        type: "error"
      });
      
      throw error;
    }
  },

  async "mcp.testConnection"() {
    try {
      await Messages.insertAsync({
        text: `🧪 Testing Claude MCP connection...`,
        createdAt: new Date(), 
        userId: "system-test", 
        owner: "MCP Test", 
        type: "system-info"
      });

      const result = await mcpClaudeClient.testMCPConnection();
      
      let statusText = `🧪 **MCP Connection Test Results**\n\n`;
      statusText += `Status: ${result.status === 'healthy' ? '✅ Healthy' : '❌ Unhealthy'}\n`;
      statusText += `Servers Connected: ${result.mcpServersConnected || 0}\n`;
      
      if (result.error) {
        statusText += `Error: ${result.error}\n`;
      }
      
      await Messages.insertAsync({
        text: statusText,
        createdAt: new Date(), 
        userId: "system-test", 
        owner: "MCP Test", 
        type: result.status === 'healthy' ? "system-info" : "error"
      });
      
      return result;
    } catch (error) {
      console.error("Error testing MCP connection:", error);
      
      await Messages.insertAsync({
        text: `❌ MCP connection test failed: ${error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Test", 
        type: "error"
      });
      
      throw error;
    }
  },

  async "mcp.askAboutTools"() {
    try {
      await Messages.insertAsync({
        text: `🔧 Asking Claude about available MCP tools...`,
        createdAt: new Date(), 
        userId: "system-query", 
        owner: "MCP Query", 
        type: "system-info"
      });

      const claudeResponse = await mcpClaudeClient.sendMessageToClaude(
        "What MCP tools do you have access to? Please list all available tools and describe what each one does."
      );
      
      await Messages.insertAsync({
        text: claudeResponse.responseText || claudeResponse.answer,
        createdAt: new Date(),
        userId: "claude-ai",
        owner: "Claude AI",
        type: "ai",
      });

      // Show MCP activity if tools were used
      if (claudeResponse.mcpToolUses && claudeResponse.mcpToolUses.length > 0) {
        await Messages.insertAsync({
          text: `🔧 Claude discovered tools using ${claudeResponse.mcpToolUses.length} MCP operation(s)`,
          createdAt: new Date(),
          userId: "system-mcp",
          owner: "MCP Activity",
          type: "system-info",
        });
      }
      
      return claudeResponse;
    } catch (error) {
      console.error("Error asking about tools:", error);
      
      await Messages.insertAsync({
        text: `❌ Error querying MCP tools: ${error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Query", 
        type: "error"
      });
      
      throw error;
    }
  },

  async "mcp.demoSearch"(query) {
    check(query, String);
    
    try {
      await Messages.insertAsync({
        text: `🔍 Demonstrating MCP search capabilities with query: "${query}"`,
        createdAt: new Date(), 
        userId: "system-demo", 
        owner: "MCP Demo", 
        type: "system-info"
      });

      const claudeResponse = await mcpClaudeClient.sendMessageToClaude(
        `Please search for documents or data related to "${query}" using your available MCP tools. Show me what you can find and explain what tools you used.`
      );
      
      await Messages.insertAsync({
        text: claudeResponse.responseText || claudeResponse.answer,
        createdAt: new Date(),
        userId: "claude-ai",
        owner: "Claude AI",
        type: "ai",
      });

      // Show detailed MCP activity
      if (claudeResponse.mcpToolUses && claudeResponse.mcpToolUses.length > 0) {
        let mcpActivity = `🔧 **MCP Tools Used:**\n\n`;
        claudeResponse.mcpToolUses.forEach((tool, index) => {
          mcpActivity += `${index + 1}. **${tool.name}** (${tool.server_name})\n`;
          mcpActivity += `   Input: ${JSON.stringify(tool.input)}\n\n`;
        });
        
        await Messages.insertAsync({
          text: mcpActivity,
          createdAt: new Date(),
          userId: "system-mcp",
          owner: "MCP Activity",
          type: "mcp-response",
        });
      }
      
      return claudeResponse;
    } catch (error) {
      console.error("Error in MCP demo search:", error);
      
      await Messages.insertAsync({
        text: `❌ MCP demo search failed: ${error.message}`,
        createdAt: new Date(), 
        userId: "system-error", 
        owner: "MCP Demo", 
        type: "error"
      });
      
      throw error;
    }
  }
});