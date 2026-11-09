#!/usr/bin/env node
// Funguo as an MCP server: any MCP client (Claude Desktop, Claude Code, an
// agent framework) can search listings, pay into a PayPal escrow hold, confirm
// receipt or open a dispute. The tools are the ones in buyerTools.js and talk
// to a running Funguo over HTTP, so the server can point at localhost or at the
// hosted demo.
//
//   FUNGUO_URL=https://<your-funguo> node backend/mcp.js
//
// Claude Code:   claude mcp add funguo -e FUNGUO_URL=http://localhost:3000 -- node /abs/path/backend/mcp.js
// Claude Desktop: add to claude_desktop_config.json ->
//   "mcpServers": { "funguo": { "command": "node", "args": ["/abs/path/backend/mcp.js"],
//                               "env": { "FUNGUO_URL": "http://localhost:3000" } } }
//
// Transport: MCP stdio (newline-delimited JSON-RPC 2.0). stdout carries
// protocol messages only; logs go to stderr.
import readline from 'node:readline';
import { BUYER_TOOLS, createBuyerClient } from './buyerTools.js';

const BASE = (process.env.FUNGUO_URL || 'http://localhost:3000').replace(/\/$/, '');
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const funguo = createBuyerClient(BASE, { buyerName: process.env.FUNGUO_BUYER_NAME || 'MCP shopping agent' });

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
const log = (...a) => console.error('[funguo-mcp]', ...a);

async function handle(req) {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'funguo', version: '0.2.0' },
        instructions:
          'Funguo is escrow on PayPal. Payments are held as a PayPal authorization and reach the seller only after the buyer confirms receipt or a dispute is decided. Check each listing\'s risk before paying, and inspect the item before confirm_receipt.',
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: BUYER_TOOLS.map(({ name, description, input_schema }) => ({ name, description, inputSchema: input_schema })) };
    case 'tools/call': {
      try {
        const out = await funguo.run(params?.name, params?.arguments);
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
    default: {
      if (id === undefined) return undefined; // notification (e.g. notifications/initialized)
      const err = new Error(`Method not found: ${method}`);
      err.code = -32601;
      throw err;
    }
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
  try {
    const result = await handle(req);
    if (req.id !== undefined && result !== undefined) send({ id: req.id, result });
  } catch (e) {
    if (req.id !== undefined) send({ id: req.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});
log(`ready, talking to ${BASE}`);
