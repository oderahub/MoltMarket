/**
 * api.js — Express router with all MoltMarket API endpoints.
 *
 * UPGRADED:
 * - Skill execution is now ASYNC (fetches real on-chain data)
 * - Added bounty board endpoints (POST/GET bounties)
 * - Ledger persists to disk (survives restarts)
 *
 * Endpoints:
 *   FREE:
 *     GET  /                        — API info
 *     GET  /health                  — Health check
 *     GET  /skills                  — Browse all skills
 *     GET  /skills/:id              — Skill preview
 *     GET  /ledger                  — Payment ledger
 *     GET  /ledger/summary          — Ledger stats
 *     GET  /bounties                — Browse bounties
 *     GET  /bounties/:id            — Bounty details
 *     POST /bounties                — Post a new bounty (free)
 *
 *   PAID (x402 gated):
 *     POST /skills/:id/execute      — Execute a skill (requires payment)
 */

import { Router } from "express";
import { paymentGate } from "../middleware/paymentGate.js";
import {
  listSkills,
  getSkill,
  getSkillPreview,
  resolveProviders,
  postBounty,
  listBounties,
  getBounty,
  updateBounty,
  getTrustScore,
  getTrustTier,
  updateTrustScore,
} from "../services/skills.js";
import {
  recordIncomingPayment,
  distributeRevenue,
  getLedger,
  getLedgerSummary,
} from "../services/ledger.js";
import {
  getTreasurySummary,
  getSimulatedYield,
  accrueSimulatedYield,
  spendSimulatedYield,
  STACKING_DAO,
} from "../services/treasury.js";
import config from "../config.js";
import log from "../utils/logger.js";

const router = Router();

// ---------------------------------------------------------------------------
// FREE ENDPOINTS
// ---------------------------------------------------------------------------

router.get("/", (req, res) => {
  res.json({
    name: "MoltMarket",
    tagline: "Bitcoin Intelligence Bounty Board — agents hire agents via x402 on Stacks",
    version: "2.0.0",
    description:
      "x402-powered agent skills marketplace on Stacks. " +
      "Skills fetch REAL on-chain data from the Hiro API. " +
      "Every payment settles on-chain. Multi-hop revenue distribution.",
    protocol: "x402 (HTTP 402 Payment Required)",
    blockchain: "Stacks (Bitcoin L2)",
    network: config.stacksNetwork,
    platformAddress: config.platformAddress,
    endpoints: {
      free: {
        "GET /": "This page",
        "GET /health": "Health check",
        "GET /skills": "Browse all available skills",
        "GET /skills/:id": "Preview a specific skill",
        "GET /bounties": "Browse posted bounties",
        "GET /bounties/:id": "Bounty details",
        "POST /bounties": "Post a new bounty (JSON body: title, description, reward)",
        "PATCH /bounties/:id": "Update bounty reward/description (dynamic negotiation)",
        "GET /ledger": "View all payment records",
        "GET /ledger/summary": "Payment summary statistics",
      },
      paid: {
        "POST /skills/:id/execute":
          "Execute a skill. Without payment-signature → 402. " +
          "With payment-signature → pay, execute, get real on-chain data.",
      },
    },
    howToPay: {
      step1: "GET /skills to browse available skills and prices",
      step2: "POST /skills/:id/execute (no header) → get 402 with payment requirements",
      step3: "Create signed STX transfer to payTo address for required amount",
      step4: "Serialize tx to hex, wrap in x402 payload, base64-encode as payment-signature header",
      step5: "Retry POST /skills/:id/execute with payment-signature header",
      step6: "Receive skill output (REAL on-chain data) + payment-response header with txid",
    },
    links: {
      explorer: `https://explorer.hiro.so/?chain=${config.stacksNetwork}`,
      faucet: "https://platform.hiro.so/faucet",
    },
  });
});

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    network: config.stacksNetwork,
    platformAddress: config.platformAddress,
    dataSource: "Hiro Stacks API (live on-chain data)",
  });
});

router.get("/skills", (req, res) => {
  const skills = listSkills();
  res.json({
    count: skills.length,
    skills,
    note: "All skills return REAL on-chain data from the Stacks blockchain via Hiro API.",
    instructions:
      "POST /skills/:id/execute — first request without payment returns 402.",
  });
});

router.get("/skills/:id", async (req, res) => {
  const preview = await getSkillPreview(req.params.id);
  if (!preview) {
    return res.status(404).json({ error: `Skill '${req.params.id}' not found` });
  }
  res.json({
    ...preview,
    executeEndpoint: `POST /skills/${req.params.id}/execute`,
    instructions: "POST to execute. First request returns 402 with payment details.",
  });
});

// ---------------------------------------------------------------------------
// PAID ENDPOINT — x402 gated skill execution
// ---------------------------------------------------------------------------

router.post(
  "/skills/:id/execute",
  // First middleware: validate skill exists and apply payment gate
  (req, res, next) => {
    const skill = getSkill(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: `Skill '${req.params.id}' not found` });
    }
    req.skill = skill;

    const gate = paymentGate({
      price: skill.price,
      description: skill.name,
      asset: skill.asset,
      acceptedAssets: skill.acceptedAssets,
    });
    gate(req, res, next);
  },
  // Second middleware: execute skill after payment verified
  async (req, res) => {
    const skill = req.skill;
    const payment = req.x402;

    log.success("API", `Skill "${skill.id}" purchased! txid: ${payment.txid}`);

    const input = req.body || {};

    // Execute the skill (NOW ASYNC — fetches real blockchain data)
    let output;
    try {
      output = await skill.execute(input);
    } catch (err) {
      log.error("API", `Skill execution failed: ${err.message}`);
      return res.status(500).json({
        error: "Skill execution failed",
        details: err.message,
        payment,
      });
    }

    // Record in ledger
    const ledgerEntry = recordIncomingPayment({
      txid: payment.txid,
      from: "agent",
      amount: payment.amount,
      skillId: skill.id,
    });

    // Multi-hop revenue distribution
    const providers = resolveProviders(skill.providers);
    let distributions = [];

    const hasProviders = providers.some((p) => p.address);
    if (hasProviders) {
      try {
        distributions = await distributeRevenue({
          ledgerEntryId: ledgerEntry.id,
          totalAmount: payment.amount,
          providers,
        });
      } catch (err) {
        log.error("API", `Revenue distribution failed: ${err.message}`);
        distributions = [{ error: err.message }];
      }
    } else {
      log.warn("API", "No provider addresses configured. Skipping distribution.");
    }

    res.json({
      success: true,
      skill: { id: skill.id, name: skill.name },
      output,
      payment: {
        txid: payment.txid,
        amount: payment.amount,
        explorerUrl: payment.explorerUrl,
      },
      revenueDistribution: {
        platformFeePercent: config.platformFeePercent,
        distributions,
      },
    });
  }
);

// ---------------------------------------------------------------------------
// BOUNTY BOARD ENDPOINTS
// ---------------------------------------------------------------------------

router.get("/bounties", (req, res) => {
  const status = req.query.status || null;
  const bountyList = listBounties(status);
  res.json({
    count: bountyList.length,
    bounties: bountyList,
    instructions: {
      post: "POST /bounties with { title, description, reward, postedBy }",
      view: "GET /bounties/:id for details",
    },
  });
});

router.get("/bounties/:id", (req, res) => {
  const bounty = getBounty(req.params.id);
  if (!bounty) {
    return res.status(404).json({ error: `Bounty '${req.params.id}' not found` });
  }
  res.json(bounty);
});

router.post("/bounties", (req, res) => {
  const { title, description, reward, postedBy } = req.body || {};
  if (!title || !description) {
    return res.status(400).json({
      error: "Missing required fields: title, description",
      example: {
        title: "Audit 3 whale wallets",
        description: "Use wallet-auditor on these 3 addresses and compare risk scores",
        reward: "50000 microSTX",
        postedBy: "agent-007",
      },
    });
  }
  const bounty = postBounty({ title, description, reward, postedBy });
  res.status(201).json(bounty);
});

/**
 * PATCH /bounties/:id — Update bounty reward/description (dynamic negotiation).
 * Enables agent-to-agent price negotiation before execution.
 */
router.patch("/bounties/:id", (req, res) => {
  const { reward, description, postedBy } = req.body || {};
  if (!reward && !description) {
    return res.status(400).json({
      error: "Provide 'reward' or 'description' to update",
      example: {
        reward: "8000",
        description: "Updated scope: include risk analysis",
        postedBy: "agent-who-posted-bounty",
      },
    });
  }

  const updated = updateBounty(req.params.id, { reward, description, postedBy });
  if (!updated) {
    return res.status(404).json({ error: `Bounty '${req.params.id}' not found` });
  }
  if (updated.error) {
    return res.status(400).json(updated);
  }

  log.info("API", `Bounty ${req.params.id} updated: reward=${reward}`);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// LEDGER
// ---------------------------------------------------------------------------

router.get("/ledger", (req, res) => {
  res.json({ ledger: getLedger() });
});

router.get("/ledger/summary", (req, res) => {
  res.json(getLedgerSummary());
});

// ---------------------------------------------------------------------------
// TREASURY ENDPOINTS — StackingDAO yield tracking
// ---------------------------------------------------------------------------

/**
 * GET /treasury/:address — Get treasury summary (stSTXbtc + sBTC rewards)
 */
router.get("/treasury/:address", async (req, res) => {
  try {
    const summary = await getTreasurySummary(req.params.address);
    res.json(summary);
  } catch (err) {
    log.error("API", `Treasury fetch failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /treasury/yield/simulated — Get simulated yield balance (for demo)
 */
router.get("/treasury/yield/simulated", (req, res) => {
  res.json({
    yieldSats: getSimulatedYield(),
    source: "simulated",
    cycle: 114,
    contracts: STACKING_DAO,
  });
});

/**
 * POST /treasury/yield/accrue — Simulate yield accrual
 */
router.post("/treasury/yield/accrue", (req, res) => {
  const newYield = accrueSimulatedYield(req.body?.amount);
  res.json({ yieldSats: newYield });
});

/**
 * POST /treasury/yield/spend — Spend yield for x402 payment
 */
router.post("/treasury/yield/spend", (req, res) => {
  const { amount } = req.body || {};
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const result = spendSimulatedYield(amount);

  if (result.success) {
    log.success("Treasury", `Yield spent: ${amount} sats (${result.remaining} remaining)`);
    res.json({
      success: true,
      spent: amount,
      remaining: result.remaining,
      txType: "yield-payment",
    });
  } else {
    res.status(400).json({
      success: false,
      error: "Insufficient yield",
      available: result.remaining,
      needed: result.needed,
    });
  }
});

// ---------------------------------------------------------------------------
// TRUST & REPUTATION ENDPOINTS
// ---------------------------------------------------------------------------

/**
 * GET /trust/:address — Get agent trust score and tier
 */
router.get("/trust/:address", (req, res) => {
  const score = getTrustScore(req.params.address);
  const tier = getTrustTier(score);
  res.json({
    address: req.params.address,
    score,
    tier,
    description: `${tier} tier agent with ${score}/1000 trust score`,
  });
});

/**
 * POST /demo/log — Broadcast a log message to WebSocket clients
 * Used by demo scripts to send step-by-step updates to frontend
 */
router.post("/demo/log", (req, res) => {
  const { step, type, message, data } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message required" });
  }

  // Use appropriate log type
  const logType = type || "info";
  if (log[logType]) {
    log[logType]("DEMO", message, data);
  } else {
    log.info("DEMO", message, data);
  }

  res.json({ success: true, step, broadcasted: true });
});

// ---------------------------------------------------------------------------
// DEMO MODE — Runs REAL agent scripts with REAL transactions
// ---------------------------------------------------------------------------

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let demoRunning = false;
let demoProcess = null;

router.post("/demo/start", async (req, res) => {
  if (demoRunning) {
    return res.status(409).json({ error: "Demo already running" });
  }

  // Check which demo to run (negotiation or full)
  const demoType = req.body?.type || "negotiation";
  const scriptName = demoType === "full" ? "demo-full-flow.js" : "demo-negotiation.js";
  const scriptPath = join(__dirname, "../../scripts", scriptName);

  demoRunning = true;
  log.agent("DEMO", `Starting ${scriptName}...`);

  res.json({
    status: "Demo started",
    script: scriptName,
    message: "Watch the terminal for REAL agent activity with REAL transactions"
  });

  // Spawn the demo script as a child process
  demoProcess = spawn("node", [scriptPath], {
    cwd: join(__dirname, "../.."),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Stream stdout to WebSocket
  demoProcess.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      // Parse and categorize the output
      if (line.includes("✅") || line.includes("Paid!") || line.includes("Posted")) {
        log.success("AGENT", line.trim());
      } else if (line.includes("❌") || line.includes("Error") || line.includes("Failed")) {
        log.error("AGENT", line.trim());
      } else if (line.includes("🤖") || line.includes("Agent")) {
        log.agent("AGENT", line.trim());
      } else if (line.includes("txid:") || line.includes("explorer.hiro.so")) {
        log.success("TX", line.trim());
      } else if (line.includes("===") || line.includes("---")) {
        // Skip dividers
      } else if (line.trim()) {
        log.info("DEMO", line.trim());
      }
    }
  });

  demoProcess.stderr.on("data", (data) => {
    log.error("DEMO", data.toString().trim());
  });

  demoProcess.on("close", (code) => {
    demoRunning = false;
    demoProcess = null;
    if (code === 0) {
      log.success("DEMO", "Demo completed successfully! All transactions are REAL.");
      log.info("DEMO", "View on explorer: https://explorer.hiro.so/?chain=testnet");
    } else {
      log.error("DEMO", `Demo exited with code ${code}`);
    }
  });

  demoProcess.on("error", (err) => {
    demoRunning = false;
    demoProcess = null;
    log.error("DEMO", `Failed to start demo: ${err.message}`);
  });
});

router.post("/demo/stop", (req, res) => {
  if (!demoRunning || !demoProcess) {
    return res.status(400).json({ error: "No demo running" });
  }

  demoProcess.kill("SIGTERM");
  demoRunning = false;
  demoProcess = null;
  log.info("DEMO", "Demo stopped by user");
  res.json({ status: "Demo stopped" });
});

router.get("/demo/status", (req, res) => {
  res.json({ running: demoRunning });
});

export default router;
