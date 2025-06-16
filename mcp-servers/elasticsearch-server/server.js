// mcp-servers/elasticsearch-server/server.js - COMPLETE REPLACEMENT

import express from 'express';
import cors from 'cors';
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.MCP_ELASTICSEARCH_PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Elasticsearch connection
let esClient = null;

const ES_NODE = process.env.ES_NODE || 'https://0267cb4829484875ab688566f046c21a.us-central1.gcp.cloud.es.io:443';
const ES_API_KEY = process.env.ES_API_KEY || 'aXd3NzlKWUJWc2YwU1VOQmFfemM6NVI4NDZTZVQtOTd2WXV1ZDBudGVWUQ==';

async function initElasticsearch() {
  try {
    console.error('🔗 Connecting to Elasticsearch Cloud...');
    
    esClient = new Client({
      node: ES_NODE,
      auth: { apiKey: ES_API_KEY },
      tls: { rejectUnauthorized: true },
      requestTimeout: 30000,
      pingTimeout: 3000,
      maxRetries: 3
    });
    
    const health = await esClient.cluster.health();
    const info = await esClient.info();
    
    console.error(`✅ Connected to Elasticsearch Cloud`);
    console.error(`   Cluster: ${info.cluster_name}`);
    console.error(`   Version: ${info.version.number}`);
    console.error(`   Status: ${health.status}`);
    
    return true;
  } catch (error) {
    console.error('❌ Elasticsearch connection failed:', error.message);
    throw error;
  }
}

// HTTP MCP endpoints
app.get('/mcp', (req, res) => {
  res.json({
    name: 'elasticsearch-mcp-server',
    version: '1.0.0',
    transport: 'http'
  });
});

app.get('/mcp/tools', (req, res) => {
  const tools = [
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
            description: 'Fields to include',
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'object' },
              { type: 'boolean' }
            ]
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
      case 'list_indices':
        result = await listIndices(params);
        break;
      case 'count_documents':
        result = await countDocuments(params);
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
    const health = await esClient.cluster.health();
    res.json({ 
      status: 'healthy', 
      cluster_health: health.status, 
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

// Elasticsearch Operations
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
    throw new Error(`Search failed: ${error.message}`);
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
    throw new Error(`Vector search failed: ${error.message}`);
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
    throw new Error(`Index operation failed: ${error.message}`);
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
    throw new Error(`Get document failed: ${error.message}`);
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
    throw new Error(`List indices failed: ${error.message}`);
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
    throw new Error(`Count documents failed: ${error.message}`);
  }
}

async function startServer() {
  try {
    await initElasticsearch();
    
    app.listen(PORT, () => {
      console.error(`🚀 Elasticsearch MCP HTTP Server started on port ${PORT}`);
      console.error(`📋 Available endpoints:`);
      console.error(`   GET  /mcp - Server info`);
      console.error(`   GET  /mcp/tools - List tools`);
      console.error(`   POST /mcp/tools/:toolName - Execute tool`);
      console.error(`   GET  /health - Health check`);
      console.error(`🔧 Tools: search_documents, vector_search_documents, index_document, get_document, list_indices, count_documents`);
      console.error(`🌐 Base URL: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start Elasticsearch MCP HTTP Server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.error('🛑 Shutting down Elasticsearch MCP Server...');
  if (esClient) {
    await esClient.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('🛑 Shutting down Elasticsearch MCP Server...');
  if (esClient) {
    await esClient.close();
  }
  process.exit(0);
});

startServer().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});