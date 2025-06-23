// server/mcp-sse-endpoints.js - SSE endpoints for Claude MCP Connector

import { WebApp } from 'meteor/webapp';
import { HTTP } from 'meteor/http';

// MCP HTTP Server URLs (existing servers)
const MCP_HTTP_SERVERS = {
  mongodb: 'http://localhost:3001/mcp',
  elasticsearch: 'http://localhost:3002/mcp', 
  fhir: 'http://localhost:3003/mcp'
};

// SSE endpoint for MongoDB MCP server
WebApp.connectHandlers.use('/mcp/mongodb/sse', async (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }

  try {
    console.log('📡 SSE request to MongoDB MCP server');
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Parse the request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const mcpRequest = JSON.parse(body);
        console.log('📨 MCP Request:', mcpRequest.method, mcpRequest.params);

        let mcpResponse;

        if (mcpRequest.method === 'tools/list') {
          // Forward to HTTP server
          const httpResponse = await HTTP.call('GET', `${MCP_HTTP_SERVERS.mongodb}/tools`);
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            result: httpResponse.data
          };
        } else if (mcpRequest.method === 'tools/call') {
          // Forward tool call to HTTP server
          const { name, arguments: args } = mcpRequest.params;
          const httpResponse = await HTTP.call('POST', `${MCP_HTTP_SERVERS.mongodb}/tools/${name}`, {
            data: args
          });
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(httpResponse.data.result, null, 2)
                }
              ]
            }
          };
        } else {
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            error: {
              code: -32601,
              message: "Method not found"
            }
          };
        }

        // Send SSE response
        res.write(`data: ${JSON.stringify(mcpResponse)}\n\n`);
        res.end();

      } catch (error) {
        console.error('❌ SSE MongoDB error:', error);
        const errorResponse = {
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32603,
            message: error.message
          }
        };
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        res.end();
      }
    });

  } catch (error) {
    console.error('❌ MongoDB SSE endpoint error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

// SSE endpoint for Elasticsearch MCP server
WebApp.connectHandlers.use('/mcp/elasticsearch/sse', async (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }

  try {
    console.log('📡 SSE request to Elasticsearch MCP server');
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Parse the request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const mcpRequest = JSON.parse(body);
        console.log('📨 MCP Request:', mcpRequest.method, mcpRequest.params);

        let mcpResponse;

        if (mcpRequest.method === 'tools/list') {
          const httpResponse = await HTTP.call('GET', `${MCP_HTTP_SERVERS.elasticsearch}/tools`);
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            result: httpResponse.data
          };
        } else if (mcpRequest.method === 'tools/call') {
          const { name, arguments: args } = mcpRequest.params;
          const httpResponse = await HTTP.call('POST', `${MCP_HTTP_SERVERS.elasticsearch}/tools/${name}`, {
            data: args
          });
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(httpResponse.data.result, null, 2)
                }
              ]
            }
          };
        } else {
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            error: {
              code: -32601,
              message: "Method not found"
            }
          };
        }

        res.write(`data: ${JSON.stringify(mcpResponse)}\n\n`);
        res.end();

      } catch (error) {
        console.error('❌ SSE Elasticsearch error:', error);
        const errorResponse = {
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32603,
            message: error.message
          }
        };
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        res.end();
      }
    });

  } catch (error) {
    console.error('❌ Elasticsearch SSE endpoint error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

// SSE endpoint for FHIR MCP server
WebApp.connectHandlers.use('/mcp/fhir/sse', async (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }

  try {
    console.log('📡 SSE request to FHIR MCP server');
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Parse the request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const mcpRequest = JSON.parse(body);
        console.log('📨 MCP Request:', mcpRequest.method, mcpRequest.params);

        let mcpResponse;

        if (mcpRequest.method === 'tools/list') {
          // For FHIR, we'll provide a static list since it uses STDIO
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            result: {
              tools: [
                {
                  name: "search_patients",
                  description: "Search for patients using FHIR Patient resource",
                  inputSchema: {
                    type: "object",
                    properties: {
                      family: { type: "string", description: "Patient family name" },
                      given: { type: "string", description: "Patient given name" },
                      _count: { type: "number", description: "Maximum number of results", default: 20 }
                    }
                  }
                },
                {
                  name: "get_patient_observations",
                  description: "Get observations (vital signs, lab results) for a patient",
                  inputSchema: {
                    type: "object",
                    properties: {
                      patient_id: { type: "string", description: "FHIR Patient resource ID" },
                      category: { type: "string", description: "Observation category" },
                      _count: { type: "number", description: "Maximum number of results", default: 50 }
                    },
                    required: ["patient_id"]
                  }
                }
              ]
            }
          };
        } else if (mcpRequest.method === 'tools/call') {
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            result: {
              content: [
                {
                  type: "text",
                  text: "FHIR tool execution simulated - actual FHIR server would be called here."
                }
              ]
            }
          };
        } else {
          mcpResponse = {
            jsonrpc: "2.0",
            id: mcpRequest.id,
            error: {
              code: -32601,
              message: "Method not found"
            }
          };
        }

        res.write(`data: ${JSON.stringify(mcpResponse)}\n\n`);
        res.end();

      } catch (error) {
        console.error('❌ SSE FHIR error:', error);
        const errorResponse = {
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32603,
            message: error.message
          }
        };
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        res.end();
      }
    });

  } catch (error) {
    console.error('❌ FHIR SSE endpoint error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

console.log('✅ MCP SSE endpoints initialized:');
console.log('   POST /mcp/mongodb/sse - MongoDB MCP connector');
console.log('   POST /mcp/elasticsearch/sse - Elasticsearch MCP connector');
console.log('   POST /mcp/fhir/sse - FHIR MCP connector');