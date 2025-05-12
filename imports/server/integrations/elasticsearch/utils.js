import { Meteor } from "meteor/meteor";

// Standard MCP Error Codes (can be expanded)
export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom server errors (Elasticsearch specific)
  SERVER_ERROR_ES_CONNECTION_FAILED: -32011,
  SERVER_ERROR_ES_OPERATION_FAILED: -32012,
  SERVER_ERROR_ES_INDEX_NOT_FOUND: -32013, // Example specific error
};

// Custom Error class for Elasticsearch tools within Meteor
export class ElasticsearchIntegrationError extends Meteor.Error {
  constructor(errorCode, reason, details) {
    let meteorErrorType = `elasticsearch-integration-error-${errorCode}`;
    super(meteorErrorType, reason, details);
    this.mcpErrorCode = errorCode; // Store original MCP-style error code if needed
    if (details && details.meta && details.meta.statusCode) {
        this.statusCode = details.meta.statusCode;
    }
  }
}

// Helper to create an ElasticsearchIntegrationError
export function createElasticsearchError(mcpErrorCode, message, data) {
  return new ElasticsearchIntegrationError(mcpErrorCode, message, data);
}

// Specific error creators
export function invalidParamsError(id, message, data) {
  return createElasticsearchError(MCP_ERROR_CODES.INVALID_PARAMS, message || "Invalid parameters provided.", data);
}

export function esOperationFailedError(id, message, data) {
  // Try to extract a more specific message from Elasticsearch client errors
  let detailedMessage = message;
  let errorDetails = data;
  if (data && data.meta && data.meta.body && data.meta.body.error) {
    const esError = data.meta.body.error;
    detailedMessage = esError.reason || (esError.root_cause && esError.root_cause[0] && esError.root_cause[0].reason) || message;
    // errorDetails = data.meta.body; // Keep the full ES error body for details
  }
  return createElasticsearchError(MCP_ERROR_CODES.SERVER_ERROR_ES_OPERATION_FAILED, detailedMessage, errorDetails);
}

export function internalError(id, message, data) {
  return createElasticsearchError(MCP_ERROR_CODES.INTERNAL_ERROR, message || "An internal server error occurred.", data);
}

