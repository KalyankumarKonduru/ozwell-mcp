import { Meteor } from "meteor/meteor";
import { Accounts } from "meteor/accounts-base";

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

  // Use async count check for Meteor 3.x

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
