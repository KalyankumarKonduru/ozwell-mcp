import { Meteor } from "meteor/meteor";
import { MongoInternals } from "meteor/mongo";

// Import SSE endpoints for Claude MCP Connector
import "./mcp-sse-endpoints.js";

// -------------------------------
// Ensure Meteor uses external Mongo if MONGO_URL is set
// -------------------------------
const mongoUrl = process.env.MONGO_URL ||
(Meteor.settings.private && Meteor.settings.private.MONGO_URL);

if (mongoUrl) {
MongoInternals.defaultRemoteCollectionDriver =
new MongoInternals.RemoteCollectionDriver(mongoUrl);
}

// Import collections and methods so they are registered with Meteor
import "../imports/api/messages.js";

// Explicitly log before and after importing methods.js
console.log("Attempting to import imports/api/methods.js from server/main.js...");
import "../imports/api/methods.js";
console.log("Successfully imported imports/api/methods.js from server/main.js.");

// Import startup routines
import "../imports/startup/server"; // For any server-specific startup configurations

Meteor.startup(() => {
console.log("Ozwell MCP Chat Server Started");

// Check for required environment variables
const settings = Meteor.settings.private || {};

if (!settings.CLAUDE_API_KEY) {
console.warn("WARNING: Claude API Key not found in settings.json. AI features may not work.");
}

console.log("🔧 Claude MCP Connector configured:");
console.log(`   Model: ${settings.CLAUDE_MODEL || 'claude-sonnet-4-20250514'}`);
console.log(`   MongoDB SSE: ${settings.MONGODB_MCP_SERVER_URL || 'Not configured'}`);
console.log(`   Elasticsearch SSE: ${settings.ELASTICSEARCH_MCP_SERVER_URL || 'Not configured'}`);
console.log(`   FHIR SSE: ${settings.FHIR_MCP_SERVER_URL || 'Not configured'}`);

console.log("\n🚀 Ready for Claude MCP demonstrations!");
console.log("   - Upload documents for processing");
console.log("   - Ask Claude about available tools");
console.log("   - Try MCP search demonstrations");
console.log("   - Claude will automatically use MCP servers when needed");
});