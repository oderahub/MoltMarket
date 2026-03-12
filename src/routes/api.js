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
  listSettlements,
} from "../services/ledger.js";
import {
  createOrHydrateIntent,
  failIntent,
  getIntent,
  getIntentAttestation,
  getIntentRegistrySummary,
  listIntents,
  markIntentPaymentRequired,
  completeIntent,
  recordIntentSettlement,
} from "../services/intents.js";
import {
  getTreasurySummary,
  getSimulatedYield,
  accrueSimulatedYield,
  spendSimulatedYield,
  STACKING_DAO,
} from "../services/treasury.js";
import config from "../config.js";
import log from "../utils/logger.js";
import {
  PAYMENT_RESPONSE_HEADER,
  buildPaymentResponse,
  getPaymentFailureReason,
  getExplorerTxUrl,
  isExecutionUnlockedPayment,
} from "../utils/x402.js";

const router = Router();

function readHeader(req, name) {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}

function getRequestedIntentId(req) {
  return readHeader(req, "x-intent-id") || req.body?.intentId || null;
}

function getRequestedPaymentMethod(req) {
  if (readHeader(req, "x-yield-payment")) return "yield-payment";
  if (readHeader(req, "x-payment-txid")) return "direct-txid";
  if (readHeader(req, "payment-signature")) return "payment-signature";
  return null;
}

function buildRegistryLinks(intentId) {
  return {
    intent: `/registry/intents/${intentId}`,
    attestation: `/registry/intents/${intentId}/attestation`,
    settlements: `/registry/settlements?intentId=${intentId}`,
    mode: "api-attested",
    attestationMode: "express-registry-api",
    contract: {
      identifier: config.intentRegistry.contractId,
      name: config.intentRegistry.contractName,
      path: config.intentRegistry.contractPath,
      network: config.intentRegistry.network,
      deploymentStatus: config.intentRegistry.deploymentStatus,
      deploymentTxid: config.intentRegistry.deploymentTxid,
      deploymentExplorerUrl: config.intentRegistry.deploymentExplorerUrl,
    },
  };
}

function buildTransactionReferences({ intentId, payment, distributions = [] }) {
  const references = [];

  if (payment) {
    references.push({
      kind: "payment",
      label: `${payment.asset} execution payment`,
      txid: payment.txid,
      asset: payment.asset,
      amount: payment.amount,
      explorerUrl: payment.explorerUrl || null,
      explorerReady: Boolean(payment.explorerUrl),
      fundingSource: payment.fundingSource || "principal",
      principalPreserved: Boolean(payment.principalPreserved),
      proofStatus: payment.proofStatus || null,
    });
  }

  for (const distribution of distributions) {
    references.push({
      kind: "distribution",
      label: `Provider payout: ${distribution.name}`,
      txid: distribution.txid || "",
      asset: distribution.asset,
      amount: distribution.amount,
      explorerUrl: distribution.explorerUrl || null,
      explorerReady: Boolean(distribution.explorerUrl),
      status: distribution.status || (distribution.txid ? "broadcasted" : "recorded"),
      note: distribution.note || null,
    });
  }

  references.push({
    kind: "registry",
    label: "Intent attestation record",
    txid: "",
    asset: "registry",
    amount: "0",
    explorerUrl: null,
    explorerReady: false,
    status: "available",
    registryUrl: `/registry/intents/${intentId}/attestation`,
  });

  references.push({
    kind: "registry-contract",
    label: "Deployed registry contract",
    txid: config.intentRegistry.deploymentTxid,
    asset: "registry",
    amount: "0",
    explorerUrl: config.intentRegistry.deploymentExplorerUrl || null,
    explorerReady: Boolean(config.intentRegistry.deploymentExplorerUrl),
    status: config.intentRegistry.deploymentStatus,
    registryUrl: `/registry/intents/${intentId}`,
  });

  return references;
}

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
        "GET /registry/intents": "List verifiable execution intents",
        "GET /registry/intents/:id": "Inspect a specific verifiable intent",
        "GET /registry/intents/:id/attestation": "Read the Express registry API attestation for an intent, including the deployed testnet registry contract reference",
        "GET /registry/settlements": "List recorded ledger settlements",
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
      note: "Set x-payment-asset to request sBTC or USDCx quotes; USDCx currently uses x-payment-txid proof.",
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

router.get("/registry/intents", (req, res) => {
  const intents = listIntents({
    status: req.query.status || null,
    skillId: req.query.skillId || null,
    asset: req.query.asset || null,
    txid: req.query.txid || null,
  });

  res.json({
    count: intents.length,
    summary: getIntentRegistrySummary(),
    intents,
  });
});

router.get("/registry/intents/:id", (req, res) => {
  const intent = getIntent(req.params.id);
  if (!intent) {
    return res.status(404).json({ error: `Intent '${req.params.id}' not found` });
  }

  res.json(intent);
});

router.get("/registry/intents/:id/attestation", (req, res) => {
  const attestation = getIntentAttestation(req.params.id);
  if (!attestation) {
    return res.status(404).json({ error: `Attestation for intent '${req.params.id}' not found` });
  }

  res.json(attestation);
});

router.get("/registry/settlements", (req, res) => {
  const settlements = listSettlements({
    asset: req.query.asset || null,
    skillId: req.query.skillId || null,
    intentId: req.query.intentId || null,
    txid: req.query.txid || null,
  });

  res.json({
    count: settlements.length,
    settlements,
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

    req.intentRecord = createOrHydrateIntent({
      intentId: getRequestedIntentId(req),
      skill,
      input: req.body || {},
      request: {
        method: req.method,
        path: req.originalUrl,
      },
      metadata: {
        requestedAsset: readHeader(req, "x-payment-asset") || req.body?.preferredAsset || null,
        preferredAsset: req.body?.preferredAsset || null,
        requestedPaymentMethod: getRequestedPaymentMethod(req),
      },
    });

    if (!getRequestedPaymentMethod(req)) {
      markIntentPaymentRequired(req.intentRecord.id, {
        paymentRequestPath: req.originalUrl,
      });
    }

    const gate = paymentGate({
      price: skill.price,
      description: skill.name,
      asset: skill.asset,
      acceptedAssets: skill.acceptedAssets,
      intentId: req.intentRecord.id,
    });
    gate(req, res, next);
  },
  // Second middleware: execute skill after payment verified
  async (req, res) => {
    const skill = req.skill;
    const intent = req.intentRecord;
    const payment = req.x402;
    const registryLinks = buildRegistryLinks(intent.id);

    if (!isExecutionUnlockedPayment(payment)) {
      const errorReason = payment
        ? getPaymentFailureReason(payment)
        : "Missing verified payment proof for the selected settlement.";
      const paymentRequiredIntent = payment
        ? recordIntentSettlement(intent.id, payment)
        : markIntentPaymentRequired(intent.id, {
            paymentRequestPath: req.originalUrl,
          });

      log.warn("API", `Rejecting paid execution for "${skill.id}": ${errorReason}`);
      res.set(
        PAYMENT_RESPONSE_HEADER,
        buildPaymentResponse({
          success: false,
          txid: payment?.txid || "",
          asset: payment?.asset || "",
          intentId: intent.id,
          settlementDigest: paymentRequiredIntent?.verification?.settlementDigest || "",
          errorReason,
        })
      );

      return res.status(402).json({
        error: "Payment verification failed",
        details: errorReason,
        payment: payment
          ? {
              ...payment,
              verified: false,
              explorerUrl: payment.explorerUrl || getExplorerTxUrl(payment.txid),
            }
          : null,
        settlement: {
          asset: payment?.asset || null,
          method: payment?.method || null,
          fundingSource:
            paymentRequiredIntent?.settlement?.payment?.fundingSource || payment?.fundingSource || "principal",
          principalPreserved: Boolean(
            paymentRequiredIntent?.settlement?.payment?.principalPreserved ?? payment?.principalPreserved
          ),
          proofStatus:
            paymentRequiredIntent?.settlement?.payment?.proofStatus || payment?.proofStatus || null,
          selectedQuote: paymentRequiredIntent?.settlement?.payment?.quote || payment?.quote || null,
        },
        intent: {
          id: intent.id,
          status: paymentRequiredIntent?.status || intent.status,
          verification: paymentRequiredIntent?.verification || intent.verification,
          registryPath: registryLinks.intent,
          attestationPath: registryLinks.attestation,
        },
        verifiableIntent: paymentRequiredIntent?.verifiableIntent || intent.verifiableIntent || null,
        registry: registryLinks,
        transactions: buildTransactionReferences({
          intentId: intent.id,
          payment: paymentRequiredIntent?.settlement?.payment || payment,
        }),
      });
    }

    log.success("API", `Skill "${skill.id}" purchased! txid: ${payment.txid}`);
    const settledIntent = recordIntentSettlement(intent.id, payment);

    const input = req.body || {};

    // Execute the skill (NOW ASYNC — fetches real blockchain data)
    let output;
    try {
      output = await skill.execute(input);
    } catch (err) {
      log.error("API", `Skill execution failed: ${err.message}`);
      const failedIntent = failIntent(intent.id, {
        error: err.message,
        paymentTxid: payment.txid,
        stage: "execute",
      });
      res.set(
        PAYMENT_RESPONSE_HEADER,
        buildPaymentResponse({
          success: false,
          txid: payment.txid,
          asset: payment.asset,
          intentId: intent.id,
          settlementDigest: failedIntent?.verification?.settlementDigest || "",
          errorReason: err.message,
        })
      );
      return res.status(500).json({
        error: "Skill execution failed",
        details: err.message,
        payment: {
          ...payment,
          explorerUrl: payment.explorerUrl || getExplorerTxUrl(payment.txid),
        },
        settlement: {
          asset: payment.asset,
          method: payment.method,
          fundingSource: payment.fundingSource || failedIntent?.settlement?.payment?.fundingSource || "principal",
          principalPreserved: Boolean(
            payment.principalPreserved ?? failedIntent?.settlement?.payment?.principalPreserved
          ),
          proofStatus: payment.proofStatus || failedIntent?.settlement?.payment?.proofStatus || null,
          selectedQuote: failedIntent?.settlement?.payment?.quote || payment.quote || null,
        },
        intent: failedIntent,
        verifiableIntent: failedIntent?.verifiableIntent || settledIntent?.verifiableIntent || null,
        registry: registryLinks,
        transactions: buildTransactionReferences({
          intentId: intent.id,
          payment: failedIntent?.settlement?.payment || payment,
        }),
      });
    }

    // Record in ledger
    const ledgerEntry = recordIncomingPayment({
      txid: payment.txid,
      from: payment.payer || "agent",
      amount: payment.amount,
      skillId: skill.id,
      asset: payment.asset,
      intentId: intent.id,
      settlementMethod: payment.method,
      settlementDetails: {
        explorerUrl: payment.explorerUrl,
        verified: payment.verified !== false,
        proofStatus: payment.proofStatus || null,
        fundingSource: payment.fundingSource || "principal",
        principalPreserved: Boolean(payment.principalPreserved),
        verificationDetails: payment.verificationDetails || null,
        quote: payment.quote || null,
        yieldPowered: Boolean(payment.yieldPowered),
      },
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
          asset: payment.asset,
        });
      } catch (err) {
        log.error("API", `Revenue distribution failed: ${err.message}`);
        distributions = [{ error: err.message }];
      }
    } else {
      log.warn("API", "No provider addresses configured. Skipping distribution.");
    }

    const completedIntent = completeIntent(intent.id, {
      ledgerEntryId: ledgerEntry.id,
      paymentTxid: payment.txid,
      result: output,
      revenueDistribution: distributions,
    });
    const transactions = buildTransactionReferences({
      intentId: intent.id,
      payment: completedIntent?.settlement?.payment || payment,
      distributions,
    });

    res.set(
      PAYMENT_RESPONSE_HEADER,
      buildPaymentResponse({
        success: true,
        txid: payment.txid,
        asset: payment.asset,
        intentId: intent.id,
        settlementDigest: completedIntent?.verification?.settlementDigest || "",
      })
    );

    res.json({
      success: true,
      intent: {
        id: intent.id,
        status: completedIntent?.status || "completed",
        verification: completedIntent?.verification,
        registryPath: registryLinks.intent,
        attestationPath: registryLinks.attestation,
      },
      skill: { id: skill.id, name: skill.name },
      output,
      payment: {
        txid: payment.txid,
        amount: payment.amount,
        asset: payment.asset,
        method: payment.method,
        explorerUrl: completedIntent?.settlement?.payment?.explorerUrl || payment.explorerUrl,
        fundingSource: completedIntent?.settlement?.payment?.fundingSource || payment.fundingSource || "principal",
        principalPreserved: Boolean(
          completedIntent?.settlement?.payment?.principalPreserved ?? payment.principalPreserved
        ),
        proofStatus: completedIntent?.settlement?.payment?.proofStatus || payment.proofStatus || null,
        verificationDetails:
          completedIntent?.settlement?.payment?.verificationDetails || payment.verificationDetails || null,
      },
      settlement: {
        asset: payment.asset,
        method: payment.method,
        fundingSource: completedIntent?.settlement?.payment?.fundingSource || payment.fundingSource || "principal",
        principalPreserved: Boolean(
          completedIntent?.settlement?.payment?.principalPreserved ?? payment.principalPreserved
        ),
        proofStatus: completedIntent?.settlement?.payment?.proofStatus || payment.proofStatus || null,
        selectedQuote: completedIntent?.settlement?.payment?.quote || payment.quote || null,
      },
      revenueDistribution: {
        platformFeePercent: config.platformFeePercent,
        distributions,
      },
      verifiableIntent: completedIntent?.verifiableIntent || settledIntent?.verifiableIntent || null,
      registry: registryLinks,
      transactions,
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
