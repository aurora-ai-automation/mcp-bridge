import express from 'express';
import axios from 'axios';

const app = express();
const N8N_URL = 'https://n8n.srv971161.hstgr.cloud/mcp/custom-ghl-mcp';

// Store session IDs in memory (keyed by a simple identifier)
const sessions = new Map();

app.use(express.json({ limit: '10mb' }));

// Health check (to keep Replit alive)
app.get('/', (req, res) => {
  res.json({ status: 'Bridge is running ✅', endpoint: '/bridge' });
});

// Main bridge endpoint
app.post('/bridge', async (req, res) => {
  try {
    console.log('📥 Received from Agent Builder:', JSON.stringify(req.body, null, 2));

    // Parse incoming request
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Normalize the request to JSON-RPC 2.0 format
    const normalizedPayload = normalizeRequest(payload);
    console.log('✅ Normalized payload:', JSON.stringify(normalizedPayload, null, 2));

    // Always use regular HTTP (n8n doesn't support SSE)
    console.log('📨 Sending to n8n via HTTP');
    const n8nResponse = await sendToN8n(normalizedPayload);
    
    // Check if Agent Builder wants SSE format
    const isSSE = req.headers.accept?.includes('text/event-stream');
    
    if (isSSE) {
      // Convert JSON response to SSE format for Agent Builder
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify(n8nResponse)}\n\n`);
      res.end();
    } else {
      // Regular JSON response
      res.json(n8nResponse);
    }
  } catch (error) {
    console.error('❌ Bridge error:', error.message);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'No additional info'
    });
  }
});

// Normalize incoming request to proper JSON-RPC format
function normalizeRequest(payload) {
  const normalized = {
    jsonrpc: payload.jsonrpc || '2.0',
    method: payload.method || payload.action || 'unknown',
    params: payload.params || payload.body || payload.data || {},
    id: payload.id !== undefined ? payload.id : Date.now(),
  };

  // Special handling for initialize method - only if params are missing
  if (normalized.method === 'initialize' && 
      (!normalized.params.protocolVersion || !normalized.params.clientInfo)) {
    normalized.params = {
      protocolVersion: normalized.params.protocolVersion || '2024-11-05',
      capabilities: normalized.params.capabilities || {},
      clientInfo: normalized.params.clientInfo || {
        name: 'openai-mcp',
        version: '1.0.0'
      }
    };
  }

  return normalized;
}

// Send regular HTTP request to n8n
async function sendToN8n(payload, sessionKey = 'default') {
  try {
    console.log('🔄 Sending to n8n:', N8N_URL);
    
    let sessionId = sessions.get(sessionKey);
    
    // If this is an initialize request, clear any existing session
    if (payload.method === 'initialize') {
      sessions.delete(sessionKey);
      sessionId = null;
      console.log('🔄 Cleared existing session for re-initialization');
    }
    
    // If this is not an initialize request and no session exists, initialize first
    if (payload.method !== 'initialize' && !sessionId) {
      console.log('🔧 Auto-initializing to get session ID...');
      const initResponse = await axios.post(N8N_URL, {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'openai-mcp',
            version: '1.0.0'
          }
        },
        id: 0
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        timeout: 30000,
      });
      
      // Capture session ID from response headers
      sessionId = initResponse.headers['mcp-session-id'];
      if (sessionId) {
        sessions.set(sessionKey, sessionId);
        console.log('✅ Session ID captured:', sessionId);
      }
    }
    
    // Build headers with session ID if available
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    
    if (sessionId && payload.method !== 'initialize') {
      headers['mcp-session-id'] = sessionId;
      console.log('🔑 Using session ID:', sessionId);
    }
    
    const response = await axios.post(N8N_URL, payload, {
      headers,
      timeout: 30000,
    });

    console.log('📤 n8n response status:', response.status);
    console.log('📤 n8n response data:', JSON.stringify(response.data, null, 2));
    console.log('📤 n8n response headers:', response.headers);
    
    // Capture session ID if this is an initialize response
    if (payload.method === 'initialize' && response.headers['mcp-session-id']) {
      const newSessionId = response.headers['mcp-session-id'];
      sessions.set(sessionKey, newSessionId);
      console.log('✅ Session ID stored:', newSessionId);
    }
    
    // Parse SSE format if n8n returns it
    let parsedData = response.data;
    if (typeof response.data === 'string' && response.data.includes('event: message')) {
      // Extract JSON from SSE format: "data: {...}\n\n"
      const dataMatch = response.data.match(/data: (.+?)(?:\n\n|$)/s);
      if (dataMatch && dataMatch[1]) {
        try {
          parsedData = JSON.parse(dataMatch[1]);
          console.log('📤 Parsed SSE data:', JSON.stringify(parsedData, null, 2));
        } catch (e) {
          console.warn('⚠️ Failed to parse SSE data:', e.message);
        }
      }
    }
    
    return parsedData;
  } catch (error) {
    console.error('❌ n8n request failed:', error.message);
    if (error.response) {
      console.error('n8n error status:', error.response.status);
      console.error('n8n error data:', error.response.data);
    }
    throw error;
  }
}

// Stream SSE response from n8n back to client
async function streamToN8n(payload, res) {
  try {
    console.log('🔄 Opening SSE stream to n8n');
    const response = await axios.post(N8N_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      responseType: 'stream',
      timeout: 60000,
    });

    response.data.on('data', (chunk) => {
      console.log('📡 Streaming chunk:', chunk.toString().slice(0, 100));
      res.write(chunk);
    });

    response.data.on('end', () => {
      console.log('✅ Stream ended gracefully');
      res.end();
    });

    response.data.on('error', (error) => {
      console.error('❌ Stream error:', error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });
  } catch (error) {
    console.error('❌ Streaming failed:', error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MCP Bridge is running!`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📍 Endpoint: /bridge (POST requests)`);
  console.log(`🔗 n8n target: ${N8N_URL}`);
});
