import { Mongo } from 'meteor/mongo';

export const Messages = new Mongo.Collection('messages');

// Optionally, define a schema if you plan to use aldeed:collection2 or similar
// Messages.schema = new SimpleSchema({
//   text: { type: String },
//   createdAt: { type: Date },
//   userId: { type: String }, // Can be actual user ID or a system identifier like 'ozwell-ai'
//   owner: { type: String }, // Username or display name
//   type: { type: String, allowedValues: ['user', 'ai', 'system-error', 'mcp-response'] }, // To differentiate message sources/types
//   // Add any other fields relevant to your chat messages
// });
// Messages.attachSchema(Messages.schema);

if (Meteor.isServer) {
    Meteor.publish('messages', function() {
      console.log('Publishing messages for client');
      return Messages.find({}, { sort: { createdAt: 1 } });
    });
  }