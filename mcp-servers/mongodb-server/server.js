// mcp-servers/mongodb-server/server.js
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.MONGODB_MCP_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB connection
let mongoClient = null;
let db = null;

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://kalyankitkat555:kalyankitkat5@cluster0.yh9dreh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'ozwell';

// Initialize MongoDB connection
async function initMongoDB() {
  try {
    console.log('🔗 Connecting to MongoDB Atlas...');
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
    
    // Test connection
    await db.admin().ping();
    console.log(`✅ Connected to MongoDB Atlas database: ${DB_NAME}`);
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

// MCP Protocol handler
app.post('/mcp', async (req, res) => {
  try {
    const { jsonrpc, method, params, id } = req.body;

    // Validate MCP request format
    if (jsonrpc !== '2.0' || !method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request' },
        id: id || null
      });
    }

    console.log(`📨 MCP Request: ${method}`, params);

    let result;
    
    switch (method) {
      case 'tools/list':
        result = await listTools();
        break;
      
      case 'tools/call':
        result = await callTool(params);
        break;
        
      case 'find_documents':
        result = await findDocuments(params);
        break;
        
      case 'insert_document':
        result = await insertDocument(params);
        break;
        
      case 'update_documents':
        result = await updateDocuments(params);
        break;
        
      case 'delete_documents':
        result = await deleteDocuments(params);
        break;
        
      case 'count_documents':
        result = await countDocuments(params);
        break;
        
      case 'list_collections':
        result = await listCollections();
        break;
        
      case 'create_index':
        result = await createIndex(params);
        break;
        
      case 'list_indexes':
        result = await listIndexes(params);
        break;
        
      case 'run_aggregation':
        result = await runAggregation(params);
        break;
        
      case 'get_collection_info':
        result = await getCollectionInfo(params);
        break;

      default:
        return res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Method not found' },
          id
        });
    }

    res.json({
      jsonrpc: '2.0',
      result,
      id
    });

  } catch (error) {
    console.error('🚨 MCP Error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { 
        code: -32603, 
        message: 'Internal error',
        data: error.message 
      },
      id: req.body.id || null
    });
  }
});

// MCP Tools Implementation
async function listTools() {
  return {
    tools: [
      {
        name: 'find_documents',
        description: 'Query documents in a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            query: { type: 'object', description: 'MongoDB query object' },
            projection: { type: 'object', description: 'Fields to include/exclude' },
            sort: { type: 'object', description: 'Sort criteria' },
            limit: { type: 'number', description: 'Maximum documents to return' },
            skip: { type: 'number', description: 'Number of documents to skip' }
          },
          required: ['collection']
        }
      },
      {
        name: 'insert_document',
        description: 'Insert document(s) into a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            document: { type: ['object', 'array'], description: 'Document or array of documents to insert' }
          },
          required: ['collection', 'document']
        }
      },
      {
        name: 'update_documents',
        description: 'Update documents in a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            query: { type: 'object', description: 'Query to match documents' },
            update: { type: 'object', description: 'Update operations' },
            options: { type: 'object', description: 'Update options (upsert, multi, etc.)' }
          },
          required: ['collection', 'query', 'update']
        }
      },
      {
        name: 'delete_documents',
        description: 'Delete documents from a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            query: { type: 'object', description: 'Query to match documents to delete' },
            options: { type: 'object', description: 'Delete options' }
          },
          required: ['collection', 'query']
        }
      },
      {
        name: 'count_documents',
        description: 'Count documents in a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            query: { type: 'object', description: 'Query to match documents' }
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
      },
      {
        name: 'run_aggregation',
        description: 'Run an aggregation pipeline on a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            pipeline: { type: 'array', description: 'Aggregation pipeline stages' }
          },
          required: ['collection', 'pipeline']
        }
      }
    ]
  };
}

async function callTool(params) {
  const { name, arguments: args } = params;
  
  switch (name) {
    case 'find_documents':
      return await findDocuments(args);
    case 'insert_document':
      return await insertDocument(args);
    case 'update_documents':
      return await updateDocuments(args);
    case 'delete_documents':
      return await deleteDocuments(args);
    case 'count_documents':
      return await countDocuments(args);
    case 'list_collections':
      return await listCollections();
    case 'run_aggregation':
      return await runAggregation(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MongoDB Operations
async function findDocuments(params) {
  const { collection, query = {}, projection, sort, limit, skip } = params;
  
  let cursor = db.collection(collection).find(query);
  
  if (projection) cursor = cursor.project(projection);
  if (sort) cursor = cursor.sort(sort);
  if (skip) cursor = cursor.skip(skip);
  if (limit) cursor = cursor.limit(limit);
  
  const documents = await cursor.toArray();
  console.log(`📄 Found ${documents.length} documents in '${collection}'`);
  
  return {
    success: true,
    collection,
    count: documents.length,
    documents
  };
}

async function insertDocument(params) {
  const { collection, document } = params;
  
  if (Array.isArray(document)) {
    const result = await db.collection(collection).insertMany(document);
    console.log(`📄 Inserted ${result.insertedCount} documents into '${collection}'`);
    return {
      success: true,
      collection,
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds
    };
  } else {
    const result = await db.collection(collection).insertOne(document);
    console.log(`📄 Inserted 1 document into '${collection}'`);
    return {
      success: true,
      collection,
      insertedCount: 1,
      insertedId: result.insertedId
    };
  }
}

async function updateDocuments(params) {
  const { collection, query, update, options = {} } = params;
  
  let result;
  if (options.multi || options.updateMany) {
    result = await db.collection(collection).updateMany(query, update, options);
  } else {
    result = await db.collection(collection).updateOne(query, update, options);
  }
  
  console.log(`📄 Updated ${result.modifiedCount} documents in '${collection}'`);
  
  return {
    success: true,
    collection,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedCount: result.upsertedCount,
    upsertedId: result.upsertedId
  };
}

async function deleteDocuments(params) {
  const { collection, query, options = {} } = params;
  
  let result;
  if (options.justOne || options.deleteOne) {
    result = await db.collection(collection).deleteOne(query);
  } else {
    result = await db.collection(collection).deleteMany(query);
  }
  
  console.log(`📄 Deleted ${result.deletedCount} documents from '${collection}'`);
  
  return {
    success: true,
    collection,
    deletedCount: result.deletedCount
  };
}

async function countDocuments(params) {
  const { collection, query = {} } = params;
  
  const count = await db.collection(collection).countDocuments(query);
  console.log(`📄 Counted ${count} documents in '${collection}'`);
  
  return {
    success: true,
    collection,
    count
  };
}

async function listCollections() {
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(col => col.name);
  
  console.log(`📄 Found ${collectionNames.length} collections:`, collectionNames);
  
  return {
    success: true,
    collections: collectionNames,
    count: collectionNames.length
  };
}

async function runAggregation(params) {
  const { collection, pipeline } = params;
  
  const results = await db.collection(collection).aggregate(pipeline).toArray();
  console.log(`📄 Aggregation on '${collection}' returned ${results.length} results`);
  
  return {
    success: true,
    collection,
    count: results.length,
    results
  };
}

async function createIndex(params) {
  const { collection, keys, options = {} } = params;
  
  const indexName = await db.collection(collection).createIndex(keys, options);
  console.log(`📄 Created index '${indexName}' on '${collection}'`);
  
  return {
    success: true,
    collection,
    indexName
  };
}

async function listIndexes(params) {
  const { collection } = params;
  
  const indexes = await db.collection(collection).listIndexes().toArray();
  console.log(`📄 Found ${indexes.length} indexes on '${collection}'`);
  
  return {
    success: true,
    collection,
    count: indexes.length,
    indexes
  };
}

async function getCollectionInfo(params) {
  const { collection } = params;
  
  const stats = await db.collection(collection).stats();
  const indexes = await db.collection(collection).listIndexes().toArray();
  
  return {
    success: true,
    collection,
    stats: {
      count: stats.count,
      size: stats.size,
      avgObjSize: stats.avgObjSize,
      storageSize: stats.storageSize,
      nindexes: stats.nindexes
    },
    indexes: indexes.map(idx => ({
      name: idx.name,
      key: idx.key,
      unique: !!idx.unique
    }))
  };
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await db.admin().ping();
    res.json({ 
      status: 'healthy', 
      service: 'mongodb-mcp-server',
      database: DB_NAME,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start server
async function startServer() {
  try {
    await initMongoDB();
    
    app.listen(PORT, () => {
      console.log(`🚀 MongoDB MCP Server running on port ${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/health`);
      console.log(`🔌 MCP endpoint: http://localhost:${PORT}/mcp`);
    });
  } catch (error) {
    console.error('❌ Failed to start MongoDB MCP Server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down MongoDB MCP Server...');
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

startServer();