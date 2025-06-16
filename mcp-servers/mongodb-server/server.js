// mcp-servers/mongodb-server/server.js - COMPLETE REPLACEMENT

import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.MCP_MONGODB_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
let mongoClient = null;
let db = null;

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://kalyankitkat555:kalyankitkat5@cluster0.yh9dreh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'ozwell';

async function initMongoDB() {
  try {
    console.error('🔗 Connecting to MongoDB Atlas...');
    mongoClient = new MongoClient(MONGO_URI, {
      retryWrites: true,
      w: 'majority',
      readPreference: 'primaryPreferred',
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    
    await db.admin().ping();
    console.error(`✅ Connected to MongoDB Atlas database: ${DB_NAME}`);
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

// HTTP MCP endpoints
app.get('/mcp', (req, res) => {
  res.json({
    name: 'mongodb-mcp-server',
    version: '1.0.0',
    transport: 'http'
  });
});

app.get('/mcp/tools', (req, res) => {
  const tools = [
    {
      name: 'find_documents',
      description: 'Query documents in a MongoDB collection',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'MongoDB collection name' },
          query: { type: 'object', description: 'Query object', default: {} },
          projection: { type: 'object', description: 'Fields to include/exclude' },
          sort: { type: 'object', description: 'Sort criteria' },
          limit: { type: 'number', description: 'Maximum results', default: 50 },
          skip: { type: 'number', description: 'Skip records', default: 0 }
        },
        required: ['collection']
      }
    },
    {
      name: 'insert_document',
      description: 'Insert document(s) into MongoDB collection',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'MongoDB collection name' },
          document: { 
            description: 'Document or array of documents to insert',
            oneOf: [
              { type: 'object' },
              { type: 'array', items: { type: 'object' } }
            ]
          }
        },
        required: ['collection', 'document']
      }
    },
    {
      name: 'count_documents',
      description: 'Count documents in MongoDB collection',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'MongoDB collection name' },
          query: { type: 'object', description: 'Query object', default: {} }
        },
        required: ['collection']
      }
    },
    {
      name: 'list_collections',
      description: 'List all collections in the database',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ];

  res.json({ tools, transport: 'http' });
});

app.post('/mcp/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const params = req.body;
  
  try {
    console.error(`📨 HTTP MCP Tool Call: ${toolName}`, JSON.stringify(params));
    
    let result;
    
    switch (toolName) {
      case 'find_documents':
        result = await findDocuments(params);
        break;
      case 'insert_document':
        result = await insertDocument(params);
        break;
      case 'count_documents':
        result = await countDocuments(params);
        break;
      case 'list_collections':
        result = await listCollections();
        break;
      default:
        return res.status(404).json({ error: 'Tool not found', tool: toolName });
    }
    
    res.json({ success: true, tool: toolName, result });
    
  } catch (error) {
    console.error(`❌ Tool execution error (${toolName}):`, error);
    res.status(500).json({ success: false, tool: toolName, error: error.message });
  }
});

app.get('/health', async (req, res) => {
  try {
    await db.admin().ping();
    res.json({ status: 'healthy', database: DB_NAME, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() });
  }
});

// MongoDB Operations
async function findDocuments(params) {
  const { collection, query = {}, projection, sort, limit = 50, skip = 0 } = params;
  
  let cursor = db.collection(collection).find(query);
  
  if (projection) cursor = cursor.project(projection);
  if (sort) cursor = cursor.sort(sort);
  if (skip) cursor = cursor.skip(skip);
  if (limit) cursor = cursor.limit(limit);
  
  const documents = await cursor.toArray();
  console.error(`📄 Found ${documents.length} documents in '${collection}'`);
  
  return {
    success: true,
    collection,
    count: documents.length,
    query: query,
    documents
  };
}

async function insertDocument(params) {
  const { collection, document } = params;
  
  if (Array.isArray(document)) {
    const result = await db.collection(collection).insertMany(document);
    console.error(`📄 Inserted ${result.insertedCount} documents into '${collection}'`);
    return {
      success: true,
      collection,
      operation: 'insertMany',
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds
    };
  } else {
    const result = await db.collection(collection).insertOne(document);
    console.error(`📄 Inserted 1 document into '${collection}'`);
    return {
      success: true,
      collection,
      operation: 'insertOne',
      insertedCount: 1,
      insertedId: result.insertedId
    };
  }
}

async function countDocuments(params) {
  const { collection, query = {} } = params;
  
  const count = await db.collection(collection).countDocuments(query);
  console.error(`📄 Counted ${count} documents in '${collection}'`);
  
  return {
    success: true,
    collection,
    query,
    count
  };
}

async function listCollections() {
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(col => col.name);
  
  console.error(`📄 Found ${collectionNames.length} collections:`, collectionNames);
  
  return {
    success: true,
    database: DB_NAME,
    collections: collectionNames,
    count: collectionNames.length,
    details: collections
  };
}

async function startServer() {
  try {
    await initMongoDB();
    
    app.listen(PORT, () => {
      console.error(`🚀 MongoDB MCP HTTP Server started on port ${PORT}`);
      console.error(`📋 Available endpoints:`);
      console.error(`   GET  /mcp - Server info`);
      console.error(`   GET  /mcp/tools - List tools`);
      console.error(`   POST /mcp/tools/:toolName - Execute tool`);
      console.error(`   GET  /health - Health check`);
      console.error(`🔧 Tools: find_documents, insert_document, count_documents, list_collections`);
      console.error(`🌐 Base URL: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start MongoDB MCP HTTP Server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.error('🛑 Shutting down MongoDB MCP Server...');
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('🛑 Shutting down MongoDB MCP Server...');
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

startServer().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});