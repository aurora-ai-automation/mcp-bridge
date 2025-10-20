# MCP Bridge

## Overview
A Node.js Express server that acts as a bridge between Agent Builder and n8n, normalizing requests to JSON-RPC 2.0 format and supporting both regular HTTP and SSE streaming responses.

## Project Structure
- `index.js` - Main server file with Express routes and n8n integration
- `package.json` - Project dependencies (Express, Axios)

## Endpoints
- `GET /` - Health check endpoint that returns bridge status
- `POST /bridge` - Main bridge endpoint that receives requests and forwards to n8n

## Features
- JSON-RPC 2.0 request normalization
- SSE (Server-Sent Events) streaming support
- Regular HTTP request/response handling
- Error handling and detailed logging
- n8n integration at `https://n8n.srv971161.hstgr.cloud/mcp/custom-ghl-mcp`

## Recent Changes
- **October 20, 2025**: Initial project setup with Express bridge server

## Configuration
- Server runs on port 5000
- 10mb JSON payload limit
- 30s timeout for regular requests
- 60s timeout for streaming requests
