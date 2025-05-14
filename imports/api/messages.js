import { Mongo } from 'meteor/mongo';

export const Messages = new Mongo.Collection('messages');


if (Meteor.isServer) {
    Meteor.publish('messages', function() {
      console.log('Publishing messages for client');
      return Messages.find({}, { sort: { createdAt: 1 } });
    });
  }