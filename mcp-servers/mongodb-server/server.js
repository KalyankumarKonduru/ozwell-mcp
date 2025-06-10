import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection
let mongoClient = null;
let db = null;

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://kalyankitkat555:kalyankitkat5@cluster0.yh9dreh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'ozwell';

// Initialize MongoDB connection
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
    
    // Test connection
    await db.admin().ping();
    console.error(`✅ Connected to MongoDB Atlas database: ${DB_NAME}`);
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

// Create MCP Server instance
const server = new Server(
  {
    name: 'mongodb-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'find_documents',
        description: 'Query documents in a MongoDB collection with flexible filtering, sorting, and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection to query' 
            },
            query: { 
              type: 'object', 
              description: 'MongoDB query object (e.g., {"name": "John"} or {} for all)',
              default: {}
            },
            projection: { 
              type: 'object', 
              description: 'Fields to include/exclude (e.g., {"name": 1, "_id": 0})' 
            },
            sort: { 
              type: 'object', 
              description: 'Sort criteria (e.g., {"createdAt": -1})' 
            },
            limit: { 
              type: 'number', 
              description: 'Maximum number of documents to return',
              default: 50
            },
            skip: { 
              type: 'number', 
              description: 'Number of documents to skip for pagination',
              default: 0
            }
          },
          required: ['collection']
        }
      },
      {
        name: 'insert_document',
        description: 'Insert one or multiple documents into a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection' 
            },
            document: { 
              description: 'Document object or array of documents to insert',
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
        name: 'update_documents',
        description: 'Update documents in a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection' 
            },
            query: { 
              type: 'object', 
              description: 'Query to match documents to update' 
            },
            update: { 
              type: 'object', 
              description: 'Update operations (e.g., {"$set": {"status": "updated"}})' 
            },
            options: { 
              type: 'object', 
              description: 'Update options like upsert, multi, etc.',
              properties: {
                upsert: { type: 'boolean', default: false },
                multi: { type: 'boolean', default: false },
                updateMany: { type: 'boolean', default: false }
              }
            }
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
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection' 
            },
            query: { 
              type: 'object', 
              description: 'Query to match documents to delete' 
            },
            options: { 
              type: 'object', 
              description: 'Delete options',
              properties: {
                justOne: { type: 'boolean', default: false },
                deleteOne: { type: 'boolean', default: false }
              }
            }
          },
          required: ['collection', 'query']
        }
      },
      {
        name: 'count_documents',
        description: 'Count documents in a MongoDB collection matching a query',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection' 
            },
            query: { 
              type: 'object', 
              description: 'Query to match documents for counting',
              default: {}
            }
          },
          required: ['collection']
        }
      },
      {
        name: 'list_collections',
        description: 'List all collections in the MongoDB database',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'run_aggregation',
        description: 'Run an aggregation pipeline on a MongoDB collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection' 
            },
            pipeline: { 
              type: 'array', 
              description: 'Array of aggregation pipeline stages',
              items: { type: 'object' }
            }
          },
          required: ['collection', 'pipeline']
        }
      },
      {
        name: 'get_collection_info',
        description: 'Get detailed information about a MongoDB collection including stats and indexes',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { 
              type: 'string', 
              description: 'Name of the MongoDB collection' 
            }
          },
          required: ['collection']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    console.error(`📨 MCP Tool Call: ${name}`, JSON.stringify(args));
    
    let result;
    
    switch (name) {
      case 'find_documents':
        result = await findDocuments(args);
        break;
      case 'insert_document':
        result = await insertDocument(args);
        break;
      case 'update_documents':
        result = await updateDocuments(args);
        break;
      case 'delete_documents':
        result = await deleteDocuments(args);
        break;
      case 'count_documents':
        result = await countDocuments(args);
        break;
      case 'list_collections':
        result = await listCollections();
        break;
      case 'run_aggregation':
        result = await runAggregation(args);
        break;
      case 'get_collection_info':
        result = await getCollectionInfo(args);
        break;
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
    
  } catch (error) {
    console.error(`❌ Tool execution error (${name}):`, error);
    
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${error.message}`
    );
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

async function updateDocuments(params) {
  const { collection, query, update, options = {} } = params;
  
  let result;
  if (options.multi || options.updateMany) {
    result = await db.collection(collection).updateMany(query, update, options);
  } else {
    result = await db.collection(collection).updateOne(query, update, options);
  }
  
  console.error(`📄 Updated ${result.modifiedCount} documents in '${collection}'`);
  
  return {
    success: true,
    collection,
    operation: options.multi || options.updateMany ? 'updateMany' : 'updateOne',
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
  
  console.error(`📄 Deleted ${result.deletedCount} documents from '${collection}'`);
  
  return {
    success: true,
    collection,
    operation: options.justOne || options.deleteOne ? 'deleteOne' : 'deleteMany',
    deletedCount: result.deletedCount
  };
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

async function runAggregation(params) {
  const { collection, pipeline } = params;
  
  const results = await db.collection(collection).aggregate(pipeline).toArray();
  console.error(`📄 Aggregation on '${collection}' returned ${results.length} results`);
  
  return {
    success: true,
    collection,
    pipeline,
    count: results.length,
    results
  };
}

async function getCollectionInfo(params) {
  const { collection } = params;
  
  try {
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
        nindexes: stats.nindexes,
        totalIndexSize: stats.totalIndexSize
      },
      indexes: indexes.map(idx => ({
        name: idx.name,
        key: idx.key,
        unique: !!idx.unique,
        sparse: !!idx.sparse
      }))
    };
  } catch (error) {
    return {
      success: false,
      collection,
      error: error.message
    };
  }
}

// Start the MCP server
async function startServer() {
  try {
    // Initialize MongoDB connection
    await initMongoDB();
    
    console.error('🚀 MongoDB MCP Server (Official SDK) started');
    console.error('📋 Available tools: find_documents, insert_document, update_documents, delete_documents, count_documents, list_collections, run_aggregation, get_collection_info');
    console.error('🔌 Listening on stdio for MCP protocol communication');
    
    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
  } catch (error) {
    console.error('❌ Failed to start MongoDB MCP Server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
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

// Start the server
startServer().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});