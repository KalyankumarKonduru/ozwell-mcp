// imports/startup/server/auto-tool-loader.js

import { Meteor } from "meteor/meteor";

Meteor.startup(() => {
  // Ensure modules are loaded
  import("../../mcp/auto-tool-executor.js");
  import("../../mcp/enhanced-instruction-extractor.js");
  
  console.log("Auto Tool Executor and Enhanced Instruction Extractor loaded successfully");
});