import { Meteor } from "meteor/meteor";
import { MongoInternals } from "meteor/mongo";
import { Accounts } from "meteor/accounts-base";
// Add this import at the top
import "./ozwell-integration.js";

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

if (!settings.OZWELL_API_KEY) {
console.warn("WARNING: Ozwell API Key not found in settings.json. AI features may not work.");
}
if (!settings.MONGODB_MCP_SERVER_URL) {
console.warn("WARNING: MongoDB MCP Server URL not found in settings.json.");
}
if (!settings.ELASTICSEARCH_MCP_SERVER_URL) {
console.warn("WARNING: Elasticsearch MCP Server URL not found in settings.json.");
}
});

