// server/ozwell-integration.js - Add this new file

import { WebApp } from 'meteor/webapp';
import { HTTP } from 'meteor/http';

// MCP Server URLs
const MCP_SERVERS = {
  mongodb: 'http://localhost:3001/mcp',
  elasticsearch: 'http://localhost:3002/mcp', 
  fhir: 'http://localhost:3003/mcp'
};

// Ozwell tool discovery endpoint
WebApp.connectHandlers.use('/api/ozwell/tools', async (req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }

  try {
    console.log('🔍 Ozwell requesting tool discovery...');
    
    // Fetch tools from all MCP servers
    const allTools = {};
    
    for (const [serverName, baseUrl] of Object.entries(MCP_SERVERS)) {
      try {
        const response = await HTTP.call('GET', `${baseUrl}/tools`, { timeout: 5000 });
        allTools[serverName] = {
          baseUrl,
          tools: response.data.tools || [],
          available: true
        };
        console.log(`✅ ${serverName}: ${response.data.tools?.length || 0} tools`);
      } catch (error) {
        console.error(`❌ ${serverName} unavailable:`, error.message);
        allTools[serverName] = {
          baseUrl,
          tools: [],
          available: false,
          error: error.message
        };
      }
    }

    // Send formatted response for Ozwell
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      discovery_time: new Date().toISOString(),
      servers: allTools,
      execution_instructions: {
        method: 'POST',
        url_pattern: 'http://localhost:{port}/mcp/tools/{toolName}',
        content_type: 'application/json',
        body: 'tool_parameters_as_json'
      },
      server_mapping: {
        mongodb: { port: 3001, description: 'Document storage and retrieval' },
        elasticsearch: { port: 3002, description: 'Full-text and semantic search' }, 
        fhir: { port: 3003, description: 'Healthcare records and patient data' }
      }
    }, null, 2));

  } catch (error) {
    console.error('❌ Tool discovery error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
});

// Ozwell tool execution proxy endpoint
WebApp.connectHandlers.use('/api/ozwell/execute', async (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }

  try {
    const { server, tool, parameters } = req.body;
    
    if (!server || !tool) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Missing server or tool parameter'
      }));
      return;
    }

    if (!MCP_SERVERS[server]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: `Unknown server: ${server}`
      }));
      return;
    }

    console.log(`🔧 Ozwell executing: ${server}/${tool}`, parameters);

    // Execute the tool
    const toolUrl = `${MCP_SERVERS[server]}/tools/${tool}`;
    const response = await HTTP.call('POST', toolUrl, {
      headers: { 'Content-Type': 'application/json' },
      data: parameters || {},
      timeout: 30000
    });

    console.log(`✅ Tool execution successful: ${server}/${tool}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      server,
      tool,
      parameters,
      execution_time: new Date().toISOString(),
      result: response.data
    }));

  } catch (error) {
    console.error('❌ Tool execution error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
});

// Ozwell status endpoint
WebApp.connectHandlers.use('/api/ozwell/status', async (req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }

  try {
    const status = {};
    
    for (const [serverName, baseUrl] of Object.entries(MCP_SERVERS)) {
      try {
        const healthUrl = baseUrl.replace('/mcp', '/health');
        const response = await HTTP.call('GET', healthUrl, { timeout: 3000 });
        status[serverName] = {
          status: 'healthy',
          response: response.data
        };
      } catch (error) {
        status[serverName] = {
          status: 'unhealthy',
          error: error.message
        };
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      servers: status,
      overall_status: Object.values(status).every(s => s.status === 'healthy') ? 'healthy' : 'degraded'
    }));

  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
});

console.log('✅ Ozwell integration endpoints initialized:');
console.log('   GET  /api/ozwell/tools - Tool discovery');
console.log('   POST /api/ozwell/execute - Tool execution');
console.log('   GET  /api/ozwell/status - Server status');