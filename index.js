import express from 'express';
import axios from 'axios';

const app = express();
const N8N_URL = 'https://n8n.srv971161.hstgr.cloud/mcp/custom-ghl-mcp';

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

  // Special handling for initialize method
  if (normalized.method === 'initialize' && (!normalized.params || Object.keys(normalized.params).length === 0)) {
    normalized.params = {
      protocolVersion: payload.protocolVersion || payload.params?.protocolVersion || '2024-11-05',
      capabilities: payload.capabilities || payload.params?.capabilities || {},
      clientInfo: payload.clientInfo || payload.params?.clientInfo || {
        name: 'openai-mcp',
        version: '1.0.0'
      }
    };
  }

  return normalized;
}

// Send regular HTTP request to n8n
async function sendToN8n(payload) {
  try {
    console.log('🔄 Sending to n8n:', N8N_URL);
    const response = await axios.post(N8N_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      timeout: 30000,
    });

    console.log('📤 n8n response status:', response.status);
    return response.data;
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
