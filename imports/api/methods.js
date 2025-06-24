// imports/api/methods.js - Clean Methods

import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Messages } from "./messages.js";
import { mcpClaudeClient } from "../mcp/client.js"; 
import { extractTextFromFile } from "../mcp/document-processor.js";

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

    // Send to Claude
    try {
      const claudeResponse = await mcpClaudeClient.sendMessageToClaude(text);
      
      await Messages.insertAsync({
        text: claudeResponse.responseText || claudeResponse.answer,
        createdAt: new Date(),
        userId: "claude-ai",
        owner: "Claude",
        type: "ai",
      });

      // Log MCP activity if any tools were used
      if (claudeResponse.mcpToolUses && claudeResponse.mcpToolUses.length > 0) {
        await Messages.insertAsync({
          text: `MCP Tools Used: ${claudeResponse.mcpToolUses.length} tool(s) - ` +
                claudeResponse.mcpToolUses.map(t => `${t.name} (${t.server_name})`).join(', '),
          createdAt: new Date(),
          userId: "system-mcp",
          owner: "MCP Activity",
          type: "system-info",
        });
      }
      
      return claudeResponse;
    } catch (error) {
      console.error("Error in messages.send:", error);
      
      await Messages.insertAsync({
        text: `Error: ${error.reason || error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "System",
        type: "error",
      });
      throw error;
    }
  },

  async processFileUpload(fileUploadInfo, userContext) {
    await Messages.insertAsync({
      text: `Processing document: ${fileUploadInfo.name}`,
      createdAt: new Date(),
      userId: "system-process",
      owner: "Document Processor",
      type: "processing",
    });

    try {
      const fileBuffer = Buffer.from(fileUploadInfo.data, 'base64');
      const extractionResult = await extractTextFromFile(fileBuffer, fileUploadInfo.name, fileUploadInfo.type);
      
      if (!extractionResult.success) {
        await Messages.insertAsync({
          text: `Text extraction failed: ${extractionResult.text}`,
          createdAt: new Date(),
          userId: "system-error",
          owner: "Document Processor",
          type: "error",
        });
        return;
      }
      
      await Messages.insertAsync({
        text: `Document processed successfully. Extracted ${extractionResult.text.length} characters.`,
        createdAt: new Date(),
        userId: "system-process",
        owner: "Document Processor",
        type: "system-info",
      });
      
      // Let Claude analyze the document
      if (userContext && userContext.trim().length > 0) {
        const analysisPrompt = `I uploaded "${fileUploadInfo.name}" with context: "${userContext}"\n\nDocument content:\n\n${extractionResult.text.substring(0, 4000)}${extractionResult.text.length > 4000 ? '\n\n[Content continues...]' : ''}`;
        
        try {
          const claudeResponse = await mcpClaudeClient.sendMessageToClaude(analysisPrompt);
          
          await Messages.insertAsync({
            text: claudeResponse.responseText || claudeResponse.answer,
            createdAt: new Date(),
            userId: "claude-ai",
            owner: "Claude (Document Analysis)",
            type: "ai",
          });

          if (claudeResponse.mcpToolUses && claudeResponse.mcpToolUses.length > 0) {
            await Messages.insertAsync({
              text: `Claude used ${claudeResponse.mcpToolUses.length} MCP tool(s) for document analysis`,
              createdAt: new Date(),
              userId: "system-mcp",
              owner: "MCP Activity",
              type: "system-info",
            });
          }
        } catch (error) {
          await Messages.insertAsync({
            text: `Document processed but analysis failed: ${error.message}`,
            createdAt: new Date(),
            userId: "system-warning",
            owner: "Document Processor",
            type: "error",
          });
        }
      }
      
    } catch (error) {
      await Messages.insertAsync({
        text: `Document processing failed: ${error.message}`,
        createdAt: new Date(),
        userId: "system-error",
        owner: "Document Processor",
        type: "error",
      });
    }
  },

  // Clear chat
  async "messages.clear"() {
    try {
      await Messages.removeAsync({});
      
      await Messages.insertAsync({
        text: `Chat history cleared.`,
        createdAt: new Date(),
        userId: "system-info",
        owner: "System",
        type: "system-info",
      });
      
      return { success: true };
    } catch (error) {
      throw new Meteor.Error("clear-error", `Failed to clear: ${error.message}`);
    }
  }
});