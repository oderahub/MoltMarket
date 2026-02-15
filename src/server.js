/**
 * server.js — MoltMarket Express server entry point.
 *
 * Starts the HTTP server with:
 * - CORS enabled (for frontend/agent access from any origin)
 * - JSON body parsing
 * - All API routes mounted at /
 * - Configuration validation on startup
 * - WebSocket server for live log streaming to UI
 *
 * Usage:
 *   npm start          — Start the server
 *   npm run dev        — Start with auto-reload (Node 18+ --watch)
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import config, { validateConfig } from "./config.js";
import apiRouter from "./routes/api.js";
import log, { registerWSClient } from "./utils/logger.js";

// Validate config before starting
try {
  validateConfig();
} catch (err) {
  process.exit(1);
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next(); // skip logging
  log.info("HTTP", `${req.method} ${req.path}`);
  next();
});


// Mount all API routes
app.use("/", apiRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `${req.method} ${req.path} does not exist. Visit GET / for available endpoints.`,
  });
});

// Error handler
app.use((err, req, res, _next) => {
  log.error("Server", `Unhandled error: ${err.message}`);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// Create HTTP server (needed for WebSocket attachment)
const server = createServer(app);

// WebSocket server for live log streaming to UI
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  log.info("WebSocket", "UI client connected to live stream");
  registerWSClient(ws);

  // Send welcome message
  ws.send(JSON.stringify({
    type: "system",
    category: "WebSocket",
    message: "Connected to MoltMarket live stream",
    ts: new Date().toISOString(),
  }));
});

// Start
server.listen(config.port, config.host, () => {
  log.success("Server", `MoltMarket running on http://${config.host}:${config.port}`);
  log.info("Server", `WebSocket: ws://${config.host}:${config.port}/ws`);
  log.info("Server", `Network: ${config.stacksNetwork}`);
  log.info("Server", `Platform address: ${config.platformAddress}`);
  log.info("Server", `Platform fee: ${config.platformFeePercent}%`);
  log.info("Server", `Explorer: https://explorer.hiro.so/?chain=${config.stacksNetwork}`);
  console.log("\n📋 Endpoints:");
  console.log("   GET  /                    — API info");
  console.log("   GET  /health              — Health check");
  console.log("   GET  /skills              — Browse skills");
  console.log("   GET  /skills/:id          — Skill preview");
  console.log("   POST /skills/:id/execute  — Execute skill (x402 gated)");
  console.log("   GET  /ledger              — Payment ledger");
  console.log("   GET  /ledger/summary      — Ledger summary");
  console.log("   WS   /ws                  — Live log stream (UI terminal)");
  console.log("");
});

// Keep-alive mechanism for Render free tier (prevents sleep after 15min inactivity)
if (process.env.NODE_ENV === 'production') {
  const SELF_PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
  const DEPLOYED_URL = process.env.RENDER_EXTERNAL_URL || 'https://moltmarket-api.onrender.com';

  setInterval(async () => {
    try {
      const response = await fetch(`${DEPLOYED_URL}/health`);
      log.info("KeepAlive", `Self-ping successful: ${response.status}`);
    } catch (error) {
      log.error("KeepAlive", `Self-ping failed: ${error.message}`);
    }
  }, SELF_PING_INTERVAL);

  log.success("KeepAlive", `Started (pinging every ${SELF_PING_INTERVAL / 1000 / 60} min)`);
}
