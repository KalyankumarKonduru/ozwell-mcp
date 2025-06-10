import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Elasticsearch connection configuration
const ES_NODE = process.env.ES_NODE || 'https://0256db538dba4d808e1fd7e28b9ccd9f.us-central1.gcp.cloud.es.io:443';
const ES_API_KEY = process.env.ES_API_KEY || 'djUzTVZaY0Jmd0IteGM0a194a2w6UEFsWXhXSlpiTFpjeEI0eEVWVmVoZw==';

// Global Elasticsearch client
let esClient = null;

/**
 * Initialize Elasticsearch connection
 */
async function initElasticsearch() {
  try {
    console.error('🔗 Connecting to Elasticsearch Cloud...');
    esClient = new Client({
      node: ES_NODE,
      auth: { apiKey: ES_API_KEY },
      tls: { rejectUnauthorized: true },
      requestTimeout: 60000,
      pingTimeout: 5000,
      maxRetries: 5
    });
    await esClient.ping();
    console.error('✅ Elasticsearch ping successful');
    const health = await esClient.cluster.health();
    const info = await esClient.info();
    console.error(`✅ Connected to Elasticsearch Cloud`);
    console.error(`   Cluster: ${info.cluster_name}`);
    console.error(`   Version: ${info.version.number}`);
    console.error(`   Status: ${health.status}`);
    console.error(`   Nodes: ${health.number_of_nodes}`);
    return true;
  } catch (error) {
    console.error('❌ Elasticsearch connection failed:', JSON.stringify(error, null, 2));
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to connect to Elasticsearch: ${error.message}`
    );
  }
}
/**
 * Create MCP Server instance
 */
const server = new Server(
  {
    name: 'elasticsearch-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_documents',
        description: 'Search documents using Elasticsearch query DSL',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name to search' },
            query_body: { type: 'object', description: 'Elasticsearch query DSL' },
            from: { type: 'number', description: 'Starting offset', default: 0 },
            size: { type: 'number', description: 'Number of results', default: 10 },
            sort: { type: 'object', description: 'Sort criteria' },
            _source: { 
              oneOf: [
                { type: 'array', items: { type: 'string' } },
                { type: 'object' },
                { type: 'boolean' }
              ],
              description: 'Fields to include'
            }
          },
          required: ['index', 'query_body']
        }
      },
      {
        name: 'vector_search_documents',
        description: 'Perform vector similarity search',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            vector_field: { type: 'string', description: 'Vector field name' },
            query_vector: { type: 'array', items: { type: 'number' }, description: 'Query vector' },
            k: { type: 'number', description: 'Number of neighbors', default: 10 },
            filter: { type: 'object', description: 'Filter query' }
          },
          required: ['index', 'vector_field', 'query_vector']
        }
      },
      {
        name: 'index_document',
        description: 'Index a document',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            id: { type: 'string', description: 'Document ID (optional)' },
            document_body: { type: 'object', description: 'Document content' },
            refresh: { type: 'string', enum: ['true', 'false', 'wait_for'], default: 'wait_for' }
          },
          required: ['index', 'document_body']
        }
      },
      {
        name: 'get_document',
        description: 'Retrieve a document by ID',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            id: { type: 'string', description: 'Document ID' }
          },
          required: ['index', 'id']
        }
      },
      {
        name: 'update_document',
        description: 'Update a document',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            id: { type: 'string', description: 'Document ID' },
            update_body: { type: 'object', description: 'Update operations' },
            refresh: { type: 'string', enum: ['true', 'false', 'wait_for'], default: 'wait_for' }
          },
          required: ['index', 'id', 'update_body']
        }
      },
      {
        name: 'delete_document',
        description: 'Delete a document by ID',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            id: { type: 'string', description: 'Document ID' },
            refresh: { type: 'string', enum: ['true', 'false', 'wait_for'], default: 'wait_for' }
          },
          required: ['index', 'id']
        }
      },
      {
        name: 'bulk_operations',
        description: 'Perform bulk operations',
        inputSchema: {
          type: 'object',
          properties: {
            operations: { type: 'array', items: { type: 'object' }, description: 'Bulk operations' },
            refresh: { type: 'string', enum: ['true', 'false', 'wait_for'], default: 'wait_for' }
          },
          required: ['operations']
        }
      },
      {
        name: 'create_index',
        description: 'Create a new index',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            settings: { type: 'object', description: 'Index settings' },
            mappings: { type: 'object', description: 'Index mappings' }
          },
          required: ['index']
        }
      },
      {
        name: 'delete_index',
        description: 'Delete an index',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            allow_no_indices: { type: 'boolean', default: false }
          },
          required: ['index']
        }
      },
      {
        name: 'get_index_mapping',
        description: 'Get index mapping',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' }
          },
          required: ['index']
        }
      },
      {
        name: 'list_indices',
        description: 'List all indices',
        inputSchema: {
          type: 'object',
          properties: {
            include_hidden: { type: 'boolean', default: false }
          }
        }
      },
      {
        name: 'get_cluster_health',
        description: 'Get cluster health',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'count_documents',
        description: 'Count documents matching a query',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name' },
            query_body: { type: 'object', description: 'Query body', default: { "query": { "match_all": {} } } }
          },
          required: ['index']
        }
      }
    ]
  };
});

/**
 * Handle tool execution requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    console.error(`📨 MCP Tool Call: ${name}`, JSON.stringify(args, null, 2));
    
    let result;
    
    switch (name) {
      case 'search_documents':
        result = await searchDocuments(args);
        break;
      case 'vector_search_documents':
        result = await vectorSearchDocuments(args);
        break;
      case 'index_document':
        result = await indexDocument(args);
        break;
      case 'get_document':
        result = await getDocument(args);
        break;
      case 'update_document':
        result = await updateDocument(args);
        break;
      case 'delete_document':
        result = await deleteDocument(args);
        break;
      case 'bulk_operations':
        result = await bulkOperations(args);
        break;
      case 'create_index':
        result = await createIndex(args);
        break;
      case 'delete_index':
        result = await deleteIndex(args);
        break;
      case 'get_index_mapping':
        result = await getIndexMapping(args);
        break;
      case 'list_indices':
        result = await listIndices(args);
        break;
      case 'get_cluster_health':
        result = await getClusterHealth();
        break;
      case 'count_documents':
        result = await countDocuments(args);
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

// ==================== ELASTICSEARCH OPERATIONS ====================

async function searchDocuments(params) {
  const { index, query_body, from = 0, size = 10, sort, _source } = params;
  
  try {
    const searchParams = {
      index,
      body: query_body,
      from,
      size: Math.min(size, 1000)
    };
    
    if (sort) searchParams.sort = sort;
    if (_source !== undefined) searchParams._source = _source;
    
    const response = await esClient.search(searchParams);
    const result = response.body || response;
    
    console.error(`🔍 Search in '${index}' found ${result.hits?.total?.value || result.hits?.total || 0} documents`);
    
    return {
      success: true,
      index,
      total: result.hits?.total?.value || result.hits?.total || 0,
      hits: result.hits.hits,
      took: result.took,
      timed_out: result.timed_out,
      max_score: result.hits.max_score
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Search failed: ${error.message}`
    );
  }
}

async function vectorSearchDocuments(params) {
  const { index, vector_field, query_vector, k = 10, filter } = params;
  
  try {
    const knnQuery = {
      field: vector_field,
      query_vector: query_vector,
      k: Math.min(k, 100),
      num_candidates: k * 5
    };
    
    if (filter) {
      knnQuery.filter = filter;
    }
    
    const response = await esClient.search({
      index,
      knn: knnQuery
    });
    const result = response.body || response;
    
    console.error(`🎯 Vector search in '${index}' found ${result.hits.hits.length} documents`);
    
    return {
      success: true,
      index,
      vector_field,
      k: Math.min(k, 100),
      total: result.hits.hits.length,
      hits: result.hits.hits,
      took: result.took
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Vector search failed: ${error.message}`
    );
  }
}

async function indexDocument(params) {
  const { index, id, document_body, refresh = 'wait_for' } = params;
  
  try {
    const indexParams = {
      index,
      document: document_body,
      refresh
    };
    
    if (id) indexParams.id = id;
    
    const response = await esClient.index(indexParams);
    const result = response.body || response;
    
    console.error(`📄 Indexed document in '${index}' with ID: ${result._id}`);
    
    return {
      success: true,
      index,
      id: result._id,
      version: result._version,
      result: result.result,
      shards: result._shards
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Index operation failed: ${error.message}`
    );
  }
}

async function getDocument(params) {
  const { index, id } = params;
  
  try {
    const response = await esClient.get({ index, id });
    const result = response.body || response;
    
    console.error(`📄 Retrieved document '${id}' from '${index}'`);
    
    return {
      success: true,
      index,
      id: result._id,
      version: result._version,
      found: result.found,
      source: result._source
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return {
        success: false,
        index,
        id,
        found: false,
        error: 'Document not found'
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Get document failed: ${error.message}`
    );
  }
}

async function updateDocument(params) {
  const { index, id, update_body, refresh = 'wait_for' } = params;
  
  try {
    const response = await esClient.update({
      index,
      id,
      body: update_body,
      refresh
    });
    const result = response.body || response;
    
    console.error(`📄 Updated document '${id}' in '${index}'`);
    
    return {
      success: true,
      index,
      id: result._id,
      version: result._version,
      result: result.result,
      shards: result._shards
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Update operation failed: ${error.message}`
    );
  }
}

async function deleteDocument(params) {
  const { index, id, refresh = 'wait_for' } = params;
  
  try {
    const response = await esClient.delete({
      index,
      id,
      refresh
    });
    const result = response.body || response;
    
    console.error(`📄 Deleted document '${id}' from '${index}'`);
    
    return {
      success: true,
      index,
      id: result._id,
      version: result._version,
      result: result.result,
      shards: result._shards
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return {
        success: false,
        index,
        id,
        found: false,
        error: 'Document not found'
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Delete operation failed: ${error.message}`
    );
  }
}

async function bulkOperations(params) {
  const { operations, refresh = 'wait_for' } = params;
  
  try {
    const response = await esClient.bulk({
      body: operations,
      refresh
    });
    const result = response.body || response;
    
    const errors = result.items.filter(item => {
      const operation = Object.values(item)[0];
      return operation.error;
    });
    
    console.error(`📄 Bulk operation completed: ${result.items.length} operations, ${errors.length} errors`);
    
    return {
      success: true,
      took: result.took,
      errors: result.errors,
      items: result.items,
      total_operations: result.items.length,
      error_count: errors.length
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Bulk operation failed: ${error.message}`
    );
  }
}

async function createIndex(params) {
  const { index, settings, mappings } = params;
  
  try {
    const body = {};
    if (settings) body.settings = settings;
    if (mappings) body.mappings = mappings;
    
    const response = await esClient.indices.create({ index, body });
    const result = response.body || response;
    
    console.error(`📄 Created index '${index}'`);
    
    return {
      success: true,
      index,
      acknowledged: result.acknowledged,
      shards_acknowledged: result.shards_acknowledged
    };
  } catch (error) {
    if (error.statusCode === 400 && error.message.includes('already exists')) {
      return {
        success: false,
        index,
        error: 'Index already exists'
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Create index failed: ${error.message}`
    );
  }
}

async function deleteIndex(params) {
  const { index, allow_no_indices = false } = params;
  
  try {
    const response = await esClient.indices.delete({
      index,
      allow_no_indices
    });
    const result = response.body || response;
    
    console.error(`📄 Deleted index '${index}'`);
    
    return {
      success: true,
      index,
      acknowledged: result.acknowledged
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return {
        success: false,
        index,
        error: 'Index not found'
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Delete index failed: ${error.message}`
    );
  }
}

async function getIndexMapping(params) {
  const { index } = params;
  
  try {
    const response = await esClient.indices.getMapping({ index });
    const result = response.body || response;
    
    console.error(`📄 Retrieved mapping for index '${index}'`);
    
    return {
      success: true,
      index,
      mappings: result
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return {
        success: false,
        index,
        error: 'Index not found'
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Get mapping failed: ${error.message}`
    );
  }
}

async function listIndices(params) {
  const { include_hidden = false } = params;
  
  try {
    const response = await esClient.cat.indices({
      format: 'json',
      h: 'index,status,health,pri,rep,docs.count,store.size'
    });
    const result = response.body || response;
    
    const filteredIndices = include_hidden 
      ? result 
      : result.filter(idx => !idx.index.startsWith('.'));
    
    console.error(`📄 Found ${filteredIndices.length} indices`);
    
    return {
      success: true,
      total_indices: filteredIndices.length,
      include_hidden,
      indices: filteredIndices
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `List indices failed: ${error.message}`
    );
  }
}

async function getClusterHealth() {
  try {
    const [health, info] = await Promise.all([
      esClient.cluster.health(),
      esClient.info()
    ]);
    
    const healthResult = health.body || health;
    const infoResult = info.body || info;
    
    console.error(`🏥 Cluster health: ${healthResult.status}`);
    
    return {
      success: true,
      cluster_name: healthResult.cluster_name,
      status: healthResult.status,
      number_of_nodes: healthResult.number_of_nodes,
      number_of_data_nodes: healthResult.number_of_data_nodes,
      active_primary_shards: healthResult.active_primary_shards,
      active_shards: healthResult.active_shards,
      relocating_shards: healthResult.relocating_shards,
      initializing_shards: healthResult.initializing_shards,
      unassigned_shards: healthResult.unassigned_shards,
      version: infoResult.version.number
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Get cluster health failed: ${error.message}`
    );
  }
}

async function countDocuments(params) {
  const { index, query_body = { "query": { "match_all": {} } } } = params;
  
  try {
    const response = await esClient.count({
      index,
      body: query_body
    });
    const result = response.body || response;
    
    console.error(`📊 Counted ${result.count} documents in '${index}'`);
    
    return {
      success: true,
      index,
      count: result.count,
      query: query_body
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Count documents failed: ${error.message}`
    );
  }
}

// ==================== SERVER STARTUP ====================

/**
 * Start the MCP server
 */
async function startServer() {
  try {
    // Initialize Elasticsearch connection
    await initElasticsearch();
    
    console.error('🚀 Elasticsearch MCP Server (Official SDK) started');
    console.error('📋 Available tools: search_documents, vector_search_documents, index_document, get_document, update_document, delete_document, bulk_operations, create_index, delete_index, get_index_mapping, list_indices, get_cluster_health, count_documents');
    console.error('🔌 Listening on stdio for MCP protocol communication');
    
    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
  } catch (error) {
    console.error('❌ Failed to start Elasticsearch MCP Server:', error);
    process.exit(1);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  console.error(`🛑 Received ${signal}. Shutting down Elasticsearch MCP Server...`);
  
  try {
    if (esClient) {
      await esClient.close();
      console.error('✅ Elasticsearch client closed');
    }
    
    console.error('✅ Elasticsearch MCP Server shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// ==================== START THE SERVER ====================

startServer().catch((error) => {
  console.error('❌ Fatal error starting Elasticsearch MCP Server:', error);
  process.exit(1);
});