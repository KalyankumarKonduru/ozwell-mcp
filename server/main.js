import { Meteor } from "meteor/meteor";
import { MongoInternals } from "meteor/mongo";

// Import SSE endpoints for Claude MCP Connector
import "./mcp-sse-endpoints.js";

// Ensure Meteor uses external Mongo if MONGO_URL is set
const mongoUrl = process.env.MONGO_URL ||
(Meteor.settings.private && Meteor.settings.private.MONGO_URL);

if (mongoUrl) {
MongoInternals.defaultRemoteCollectionDriver =
new MongoInternals.RemoteCollectionDriver(mongoUrl);
}

// Import collections and methods
import "../imports/api/messages.js";
import "../imports/api/methods.js";

// Import startup routines
import "../imports/startup/server";

Meteor.startup(() => {
console.log("Claude MCP Chat Server Started");

const settings = Meteor.settings.private || {};

console.log("Claude MCP Connector configured:");
console.log(`   Model: ${settings.CLAUDE_MODEL || 'claude-opus-4-20250514'}`);
console.log(`   MongoDB SSE: ${settings.MONGODB_MCP_SERVER_URL || 'http://localhost:3000/mcp/mongodb/sse'}`);
console.log(`   Elasticsearch SSE: ${settings.ELASTICSEARCH_MCP_SERVER_URL || 'http://localhost:3000/mcp/elasticsearch/sse'}`);
console.log(`   FHIR SSE: ${settings.FHIR_MCP_SERVER_URL || 'http://localhost:3000/mcp/fhir/sse'}`);

console.log("\nServer ready - Claude will use MCP tools automatically when appropriate");
});