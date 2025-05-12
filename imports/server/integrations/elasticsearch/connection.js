import { Client } from "@elastic/elasticsearch";
import { Meteor } from "meteor/meteor";

let esClient = null;

export function getESClient() {
  if (!esClient) {
    const esNode = Meteor.settings.private?.ELASTICSEARCH_NODE || "http://localhost:9200";
    const username = Meteor.settings.private?.ELASTICSEARCH_USERNAME;
    const password = Meteor.settings.private?.ELASTICSEARCH_PASSWORD;
    const apiKey = Meteor.settings.private?.ELASTICSEARCH_API_KEY;
    const cloudID = Meteor.settings.private?.ELASTICSEARCH_CLOUD_ID;
    const insecureSSL = Meteor.settings.private?.ELASTICSEARCH_INSECURE_SSL === true;

    let clientOptions = {};

    if (cloudID) {
      clientOptions.cloud = { id: cloudID };
      if (apiKey) {
        clientOptions.auth = { apiKey };
      } else if (username && password) {
        clientOptions.auth = { username, password };
      }
    } else {
      clientOptions.node = esNode;
      if (apiKey) {
        clientOptions.auth = { apiKey };
      } else if (username && password) {
        clientOptions.auth = { username, password };
      }
    }

    // Handle SSL/TLS, especially for self-signed certificates in local dev
    if (esNode.startsWith("https://")) {
      clientOptions.tls = {
        //ca: certificates, // If you had a CA certificate to provide
        rejectUnauthorized: !insecureSSL 
      };
      // For older Elasticsearch client versions, it might be clientOptions.ssl
      // clientOptions.ssl = {
      //   rejectUnauthorized: !insecureSSL,
      //   // ca: fs.readFileSync("/path/to/ca.crt") // Example if CA cert is needed
      // };
    }

    try {
      esClient = new Client(clientOptions);
      console.log("Elasticsearch client initialized with options:", JSON.stringify(clientOptions, (key, value) => key === 'password' ? '********' : value));
    } catch (error) {
      console.error("Failed to initialize Elasticsearch client:", error);
      throw new Meteor.Error("elasticsearch-init-failed", "Could not initialize Elasticsearch client. Check server logs and settings.");
    }
  }
  return esClient;
}

export async function testESConnection() {
  if (!esClient) {
    try {
      getESClient(); 
    } catch (initError) {
      console.error("Elasticsearch client initialization failed during test connection:", initError);
      throw initError; 
    }
  }
  try {
    const health = await esClient.cluster.health();
    console.log("Elasticsearch cluster health:", health);
    return health;
  } catch (error) {
    console.error("Elasticsearch connection test failed:", error.meta ? error.meta.body : error);
    const esNode = Meteor.settings.private?.ELASTICSEARCH_NODE || "http://localhost:9200";
    const username = Meteor.settings.private?.ELASTICSEARCH_USERNAME;
    console.error(`Attempted connection to ${esNode} with username: ${username ? username : 'none'}`);
    throw new Meteor.Error("elasticsearch-connection-failed", "Failed to connect to Elasticsearch or get cluster health. Check credentials, node URL (http/https), and SSL settings.");
  }
}

