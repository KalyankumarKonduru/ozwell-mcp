// imports/mcp/enhanced-instruction-extractor.js

/**
 * Enhanced extraction of MCP instructions from Ozwell API responses
 * Handles various formats and patterns
 * @param {Object} apiResponse - The response from the Ozwell API
 * @returns {Object|null} Extracted MCP instructions or null if none found
 */
export function extractMcpInstructions(apiResponse) {
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
      
      // Look for tool_calls in various API response formats
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
        // Look for JSON in code blocks
        const jsonCodeBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const jsonBlockMatch = apiResponse.answer.match(jsonCodeBlockRegex);
        
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
        const rawJsonMatch = apiResponse.answer.match(rawJsonRegex);
        
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
        
        // Look for mcp_instructions object in raw JSON
        const mcpInstructionsRegex = /\{[\s\S]*?"mcp_instructions"[\s\S]*?\}/;
        const mcpInstructionsMatch = apiResponse.answer.match(mcpInstructionsRegex);
        
        if (mcpInstructionsMatch && mcpInstructionsMatch[0]) {
          try {
            const jsonObj = JSON.parse(mcpInstructionsMatch[0]);
            if (jsonObj.mcp_instructions) {
              return jsonObj.mcp_instructions;
            }
          } catch (e) {
            console.warn("Failed to parse mcp_instructions JSON in response:", e);
          }
        }
      }
      
      return null;
    } catch (e) {
      console.error("Error extracting MCP instructions:", e);
      return null;
    }
  }
  
  /**
   * Cleans Ozwell's response text by removing JSON blocks and technical instructions
   * @param {string} responseText - The original response text
   * @returns {string} Cleaned response suitable for user display
   */
  export function cleanResponseText(responseText) {
    if (!responseText || typeof responseText !== 'string') {
      return responseText;
    }
    
    // Remove JSON code blocks
    let cleaned = responseText.replace(/```json[\s\S]*?```/g, '');
    
    // Remove other code blocks
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    
    // Remove raw JSON patterns
    cleaned = cleaned.replace(/\{[\s\S]*?"target"[\s\S]*?"tool"[\s\S]*?"params"[\s\S]*?\}/g, '');
    cleaned = cleaned.replace(/\{[\s\S]*?"mcp_instructions"[\s\S]*?\}/g, '');
    
    // Clean up any excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();
    
    return cleaned || responseText;
  }