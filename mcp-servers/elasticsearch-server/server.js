// mcp-servers/elasticsearch-server/server.js
import express from 'express';
import cors from 'cors';
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.ELASTICSEARCH_MCP_PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Elasticsearch connection
let esClient = null;

const ES_NODE = process.env.ES_NODE || 'https://0267cb4829484875ab688566f046c21a.us-central1.gcp.cloud.es.io:443';
const ES_API_KEY = process.env.ES_API_KEY || 'aXd3NzlKWUJWc2YwU1VOQmFfemM6NVI4NDZTZVQtOTd2WXV1ZDBudGVWUQ==';

// Initialize Elasticsearch connection
async function initElasticsearch() {
  try {
    console.log('🔗 Connecting to Elasticsearch Cloud...');
    
    esClient = new Client({
      node: ES_NODE,
      auth: { apiKey: ES_API_KEY },
      tls: { rejectUnauthorized: true },
      requestTimeout: 30000,
      pingTimeout: 3000,
      maxRetries: 3,
      sniffOnStart: false,
      sniffOnConnectionFault: false
    });
    
    // Test connection
    const health = await esClient.cluster.health();
    const info = await esClient.info();
    
    console.log(`✅ Connected to Elasticsearch Cloud`);
    console.log(`   Cluster: ${info.cluster_name}`);
    console.log(`   Version: ${info.version.number}`);
    console.log(`   Status: ${health.status}`);
    
    return true;
  } catch (error) {
    console.error('❌ Elasticsearch connection failed:', error);
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
        
      case 'search_documents':
        result = await searchDocuments(params);
        break;
        
      case 'vector_search_documents':
        result = await vectorSearchDocuments(params);
        break;
        
      case 'index_document':
        result = await indexDocument(params);
        break;
        
      case 'get_document':
        result = await getDocument(params);
        break;
        
      case 'update_document':
        result = await updateDocument(params);
        break;
        
      case 'delete_document':
        result = await deleteDocument(params);
        break;
        
      case 'delete_by_query':
        result = await deleteByQuery(params);
        break;
        
      case 'bulk_operations':
        result = await bulkOperations(params);
        break;
        
      case 'create_index':
        result = await createIndex(params);
        break;
        
      case 'delete_index':
        result = await deleteIndex(params);
        break;
        
      case 'get_index_mapping':
        result = await getIndexMapping(params);
        break;
        
      case 'get_cluster_health':
        result = await getClusterHealth();
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
        name: 'search_documents',
        description: 'Search documents using Elasticsearch query DSL',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'Index name to search' },
            query_body: { type: 'object', description: 'Elasticsearch query DSL' },
            from: { type: 'number', description: 'Starting offset' },
            size: { type: 'number', description: 'Number of results to return' },
            sort: { type: 'object', description: 'Sort criteria' },
            _source: { type: ['array', 'object'], description: 'Fields to include in results' }
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
            query_vector: { type: 'array', description: 'Query vector' },
            k: { type: 'number', description: 'Number of nearest neighbors' },
            filter: { type: 'object', description: 'Filter query' },
            _source: { type: ['array', 'object'], description: 'Fields to include' }
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
            document_body: { type: 'object', description: 'Document to index' }
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
            update_body: { type: 'object', description: 'Update operations' }
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
            id: { type: 'string', description: 'Document ID' }
          },
          required: ['index', 'id']
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
        name: 'get_cluster_health',
        description: 'Get Elasticsearch cluster health',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
}

async function callTool(params) {
  const { name, arguments: args } = params;
  
  switch (name) {
    case 'search_documents':
      return await searchDocuments(args);
    case 'vector_search_documents':
      return await vectorSearchDocuments(args);
    case 'index_document':
      return await indexDocument(args);
    case 'get_document':
      return await getDocument(args);
    case 'update_document':
      return await updateDocument(args);
    case 'delete_document':
      return await deleteDocument(args);
    case 'create_index':
      return await createIndex(args);
    case 'get_cluster_health':
      return await getClusterHealth();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Elasticsearch Operations
async function searchDocuments(params) {
  const { index, query_body, from, size, sort, _source } = params;
  
  const searchParams = { index, body: query_body };
  if (from !== undefined) searchParams.from = from;
  if (size !== undefined) searchParams.size = size;
  if (sort) searchParams.sort = sort;
  if (_source) searchParams._source = _source;
  
  const response = await esClient.search(searchParams);
  const result = response.body || response;
  
  console.log(`🔍 Search in '${index}' found ${result.hits?.total?.value || result.hits?.total || 0} documents`);
  
  return {
    success: true,
    index,
    total: result.hits?.total?.value || result.hits?.total || 0,
    hits: result.hits.hits,
    took: result.took,
    timed_out: result.timed_out
  };
}

async function vectorSearchDocuments(params) {
  const { index, vector_field, query_vector, k = 10, filter, _source } = params;
  
  const knnQuery = {
    field: vector_field,
    query_vector: query_vector,
    k: k,
    num_candidates: k * 5
  };
  
  if (filter) {
    knnQuery.filter = filter;
  }
  
  const searchParams = { index, knn: knnQuery };
  if (_source) searchParams._source = _source;
  
  const response = await esClient.search(searchParams);
  const result = response.body || response;
  
  console.log(`🎯 Vector search in '${index}' found ${result.hits.hits.length} documents`);
  
  return {
    success: true,
    index,
    total: result.hits.hits.length,
    hits: result.hits.hits,
    took: result.took
  };
}

async function indexDocument(params) {
  const { index, id, document_body } = params;
  
  const indexParams = {
    index: index,
    document: document_body,
    refresh: 'wait_for'
  };
  
  if (id) indexParams.id = id;
  
  const response = await esClient.index(indexParams);
  const result = response.body || response;
  
  console.log(`📄 Indexed document in '${index}' with ID: ${result._id}`);
  
  return {
    success: true,
    index,
    id: result._id,
    version: result._version,
    result: result.result
  };
}

async function getDocument(params) {
  const { index, id } = params;
  
  const response = await esClient.get({ index, id });
  const result = response.body || response;
  
  console.log(`📄 Retrieved document '${id}' from '${index}'`);
  
  return {
    success: true,
    index,
    id: result._id,
    version: result._version,
    found: result.found,
    source: result._source
  };
}

async function updateDocument(params) {
  const { index, id, update_body } = params;
  
  const response = await esClient.update({
    index,
    id,
    body: update_body,
    refresh: 'wait_for'
  });
  const result = response.body || response;
  
  console.log(`📄 Updated document '${id}' in '${index}'`);
  
  return {
    success: true,
    index,
    id: result._id,
    version: result._version,
    result: result.result
  };
}

async function deleteDocument(params) {
  const { index, id } = params;
  
  const response = await esClient.delete({ 
    index, 
    id, 
    refresh: 'wait_for' 
  });
  const result = response.body || response;
  
  console.log(`📄 Deleted document '${id}' from '${index}'`);
  
  return {
    success: true,
    index,
    id: result._id,
    version: result._version,
    result: result.result
  };
}

async function createIndex(params) {
  const { index, settings, mappings } = params;
  
  const body = {};
  if (settings) body.settings = settings;
  if (mappings) body.mappings = mappings;
  
  const response = await esClient.indices.create({ index, body });
  const result = response.body || response;
  
  console.log(`📄 Created index '${index}'`);
  
  return {
    success: true,
    index,
    acknowledged: result.acknowledged,
    shards_acknowledged: result.shards_acknowledged
  };
}

async function getIndexMapping(params) {
  const { index } = params;
  
  const response = await esClient.indices.getMapping({ index });
  const result = response.body || response;
  
  console.log(`📄 Retrieved mapping for index '${index}'`);
  
  return {
    success: true,
    index,
    mappings: result
  };
}

async function getClusterHealth() {
  const response = await esClient.cluster.health();
  const result = response.body || response;
  
  console.log(`🏥 Cluster health: ${result.status}`);
  
  return {
    success: true,
    cluster_name: result.cluster_name,
    status: result.status,
    number_of_nodes: result.number_of_nodes,
    number_of_data_nodes: result.number_of_data_nodes,
    active_primary_shards: result.active_primary_shards,
    active_shards: result.active_shards
  };
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await esClient.cluster.health();
    const info = await esClient.info();
    
    res.json({ 
      status: 'healthy', 
      service: 'elasticsearch-mcp-server',
      cluster: info.cluster_name,
      version: info.version.number,
      health: health.status,
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
    await initElasticsearch();
    
    app.listen(PORT, () => {
      console.log(`🚀 Elasticsearch MCP Server running on port ${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/health`);
      console.log(`🔌 MCP endpoint: http://localhost:${PORT}/mcp`);
    });
  } catch (error) {
    console.error('❌ Failed to start Elasticsearch MCP Server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down Elasticsearch MCP Server...');
  if (esClient) {
    await esClient.close();
  }
  process.exit(0);
});

startServer();