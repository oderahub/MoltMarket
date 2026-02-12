/**
 * logger.js — Structured logger with WebSocket broadcast for MoltMarket.
 *
 * Logs to console AND broadcasts to connected WebSocket clients (UI terminal).
 * This enables the "live agent stream" in the Next.js frontend.
 */

// WebSocket clients (populated by server.js)
let wsClients = new Set();

/**
 * Register WebSocket clients for log broadcasting.
 * Called from server.js when clients connect.
 */
export function registerWSClient(ws) {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
}

/**
 * Broadcast a log entry to all connected WebSocket clients.
 */
function broadcast(entry) {
  const payload = JSON.stringify(entry);
  for (const client of wsClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(payload);
    }
  }
}

function timestamp() {
  return new Date().toISOString();
}

export function info(category, message, data = null) {
  const ts = timestamp();
  const parts = [`[${ts}] ℹ️  [${category}] ${message}`];
  if (data) parts.push(JSON.stringify(data, null, 2));
  console.log(parts.join("\n"));

  broadcast({ type: "info", category, message, data, ts });
}

export function warn(category, message, data = null) {
  const ts = timestamp();
  const parts = [`[${ts}] ⚠️  [${category}] ${message}`];
  if (data) parts.push(JSON.stringify(data, null, 2));
  console.warn(parts.join("\n"));

  broadcast({ type: "warn", category, message, data, ts });
}

export function error(category, message, data = null) {
  const ts = timestamp();
  const parts = [`[${ts}] ❌ [${category}] ${message}`];
  if (data) parts.push(JSON.stringify(data, null, 2));
  console.error(parts.join("\n"));

  broadcast({ type: "error", category, message, data, ts });
}

export function success(category, message, data = null) {
  const ts = timestamp();
  const parts = [`[${ts}] ✅ [${category}] ${message}`];
  if (data) parts.push(JSON.stringify(data, null, 2));
  console.log(parts.join("\n"));

  broadcast({ type: "success", category, message, data, ts });
}

export function agent(category, message, data = null) {
  const ts = timestamp();
  const parts = [`[${ts}] 🤖 [${category}] ${message}`];
  if (data) parts.push(JSON.stringify(data, null, 2));
  console.log(parts.join("\n"));

  broadcast({ type: "agent", category, message, data, ts });
}

export default { info, warn, error, success, agent, registerWSClient };
