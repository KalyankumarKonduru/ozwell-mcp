import { Meteor } from "meteor/meteor";

// Standard MCP Error Codes (can be expanded)
export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom server errors (MongoDB specific)
  SERVER_ERROR_DB_CONNECTION_FAILED: -32001,
  SERVER_ERROR_DB_OPERATION_FAILED: -32002,
  SERVER_ERROR_COLLECTION_NOT_FOUND: -32003, // Example specific error
};

// Custom Error class for MongoDB tools within Meteor
export class MongoIntegrationError extends Meteor.Error {
  constructor(errorCode, reason, details) {
    // Meteor.Error constructor is (error, reason, details)
    // We map MCP_ERROR_CODES to the 'error' string for Meteor
    let meteorErrorType = `mongodb-integration-error-${errorCode}`;
    super(meteorErrorType, reason, details);
    this.mcpErrorCode = errorCode; // Store original MCP-style error code if needed
  }
}

// Helper to create a MongoIntegrationError
export function createMongoError(mcpErrorCode, message, data) {
  return new MongoIntegrationError(mcpErrorCode, message, data);
}

// Specific error creators (examples)
export function invalidParamsError(id, message, data) {
  return createMongoError(MCP_ERROR_CODES.INVALID_PARAMS, message || "Invalid parameters provided.", data);
}

export function dbOperationFailedError(id, message, data) {
  return createMongoError(MCP_ERROR_CODES.SERVER_ERROR_DB_OPERATION_FAILED, message || "Database operation failed.", data);
}

export function internalError(id, message, data) {
  return createMongoError(MCP_ERROR_CODES.INTERNAL_ERROR, message || "An internal server error occurred.", data);
}

