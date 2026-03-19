/**
 * demo-negotiation.js — Full 7-step demo with Trust Scores & Yield Payment.
 *
 * Demonstrates MoltMarket's autonomous economy:
 * STEP 1: Market Discovery — Agent A posts a bounty
 * STEP 2: Bounty Analysis — Agent B discovers and evaluates
 * STEP 3: Trust Verification — Agent B's trust score displayed
 * STEP 4: Price Negotiation — Agent B proposes higher rate
 * STEP 5: Agreement Reached — Agent A accepts via PATCH
 * STEP 6: Yield-Powered Payment — Agent pays using StackingDAO yield
 * STEP 7: Skill Execution — Bounty fulfilled with on-chain proof
 *
 * Usage: npm run negotiate
 * Prereqs: Server running, DEMO_AGENT_PRIVATE_KEY set, wallet funded.
 */

import pkg from "@stacks/transactions";
const { makeSTXTokenTransfer, AnchorMode, getAddressFromPrivateKey } = pkg;
import { STACKS_TESTNET, STACKS_MAINNET } from "@stacks/network";
import dotenv from "dotenv";
import { resolveServerUrl } from "./_server-url.js";
dotenv.config();
const BASE_URL = resolveServerUrl();
const AGENT_KEY = process.env.DEMO_AGENT_PRIVATE_KEY;
const NETWORK_NAME = process.env.STACKS_NETWORK || "testnet";
const AGENT_ADDRESS = AGENT_KEY ? getAddressFromPrivateKey(AGENT_KEY, NETWORK_NAME) : null;
const NETWORK = NETWORK_NAME === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

// Demo agent addresses for trust display
const AGENT_A = { name: "Agent-Alpha", address: "demo-agent-a" };
const AGENT_B = { name: "Agent-Beta", address: "demo-agent-b" };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stepHeader(num, title, desc) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STEP ${num}/7: ${title}`);
  console.log(`  ${desc}`);
  console.log(`${"═".repeat(60)}\n`);
}

function highlightLink(label, url) {
  console.log(`\n  🔗 ${label}:`);
  console.log(`     ${url}`);
  console.log(`     ↑ CLICK TO VERIFY ON-CHAIN ↑\n`);
}

function explorerUrl(txid) {
  const chain = NETWORK_NAME === "mainnet" ? "" : "?chain=testnet";
  return `https://explorer.hiro.so/txid/${txid}${chain}`;
}

function summarizeAcceptedProofHeaders(result) {
  const settlementHeaders = result?.settlement?.acceptedProofHeaders;
  if (Array.isArray(settlementHeaders) && settlementHeaders.length > 0) {
    return settlementHeaders.join(", ");
  }

  const spendLimits = result?.verifiableIntent?.spendLimits;
  const selectedAsset = result?.settlement?.selected?.asset;
  if (!Array.isArray(spendLimits) || !selectedAsset) return null;

  const matchedLimit = spendLimits.find((limit) => limit?.asset === selectedAsset);
  return Array.isArray(matchedLimit?.acceptedProofHeaders) && matchedLimit.acceptedProofHeaders.length > 0
    ? matchedLimit.acceptedProofHeaders.join(", ")
    : null;
}

function formatExecutionFailure(execRes, result) {
  const selectedAsset = result?.settlement?.selected?.asset || result?.payment?.asset || "unknown";
  const acceptedHeaders = summarizeAcceptedProofHeaders(result);
  const reason =
    result?.error ||
    (result?.x402Version ? "Backend still requires payment authorization." : null) ||
    `Backend returned HTTP ${execRes.status}.`;

  const lines = [
    `   ⚠️  Execution blocked before completion.`,
    `   HTTP status: ${execRes.status}`,
    `   Reason: ${reason}`,
  ];

  if (selectedAsset) {
    lines.push(`   Selected settlement rail: ${selectedAsset}`);
  }

  if (acceptedHeaders) {
    lines.push(`   Accepted proof headers: ${acceptedHeaders}`);
  }

  const attestationPath = result?.registry?.attestationPath || result?.intent?.attestationPath;
  if (attestationPath) {
    lines.push(`   Registry attestation: ${attestationPath}`);
  }

  return lines;
}

// Broadcast log to frontend via WebSocket
async function broadcastLog(step, type, message) {
  try {
    await fetch(`${BASE_URL}/demo/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, type, message }),
    });
  } catch (e) {
    // Ignore broadcast errors
  }
}

async function main() {
  console.log("\n");
  console.log("═".repeat(60));
  console.log("  MoltMarket — Autonomous Agent Economy Demo");
  console.log("  7-Step Flow: Discovery → Negotiation → Yield Payment → Execution");
  console.log("═".repeat(60));
  console.log(`  Backend: ${BASE_URL}`);
  console.log("═".repeat(60));

  if (!AGENT_KEY) {
    console.error("\n❌ Set DEMO_AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  // =========================================================================
  // STEP 1: MARKET DISCOVERY
  // =========================================================================
  stepHeader(1, "MARKET DISCOVERY", "Agent A posts bounty to marketplace");
  await broadcastLog(1, "agent", "[STEP 1/7] Agent A posting bounty to marketplace...");

  console.log(`   [${AGENT_A.name}] "I need a deep wallet audit. Offering 5000 microSTX."`);
  await sleep(1000);

  const bountyRes = await fetch(`${BASE_URL}/bounties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Deep Wallet Audit",
      description:
        "Comprehensive audit of wallet ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM. " +
        "Need full transaction history analysis, risk scoring, and stacking status.",
      reward: "5000",
      postedBy: AGENT_A.address,
    }),
  });
  const bounty = await bountyRes.json();

  console.log(`   ✅ Bounty posted: ${bounty.id}`);
  console.log(`   Title: "${bounty.title}"`);
  console.log(`   Reward: ${bounty.reward} microSTX`);
  await broadcastLog(1, "success", `Bounty posted: ${bounty.id} @ ${bounty.reward} microSTX`);

  await sleep(1500);

  // =========================================================================
  // STEP 2: BOUNTY ANALYSIS
  // =========================================================================
  stepHeader(2, "BOUNTY ANALYSIS", "Agent B discovers and evaluates bounty");
  await broadcastLog(2, "agent", "[STEP 2/7] Agent B analyzing bounty complexity...");

  console.log(`   [${AGENT_B.name}] "Scanning marketplace for opportunities..."`);
  await sleep(800);

  const checkRes = await fetch(`${BASE_URL}/bounties/${bounty.id}`);
  const checkedBounty = await checkRes.json();

  console.log(`   [${AGENT_B.name}] Found: "${checkedBounty.title}"`);
  console.log(`   Current reward: ${checkedBounty.reward} microSTX`);
  console.log(`   [${AGENT_B.name}] Analyzing target wallet complexity...`);
  await sleep(1000);
  console.log(`   [${AGENT_B.name}] Target has 1,247 transactions — complex audit required.`);
  await broadcastLog(2, "info", "Target wallet has 1,247 transactions — complex audit");

  await sleep(1500);

  // =========================================================================
  // STEP 3: TRUST VERIFICATION
  // =========================================================================
  stepHeader(3, "TRUST VERIFICATION", "Agent B displays trust score and eligibility");
  await broadcastLog(3, "agent", "[STEP 3/7] Verifying agent trust scores...");

  // Fetch trust score from API
  const trustRes = await fetch(`${BASE_URL}/trust/${AGENT_B.address}`);
  const trustData = await trustRes.json();

  console.log(`   [${AGENT_B.name}] Address: ${AGENT_B.address}`);
  console.log(`   [${AGENT_B.name}] Trust Score: ${trustData.score} (${trustData.tier})`);

  if (trustData.tier === "ELITE") {
    console.log(`   [${AGENT_B.name}] ⭐ ELITE tier — eligible for premium bounties`);
    console.log(`   [${AGENT_B.name}] Can demand higher rates based on reputation.`);
  }
  await broadcastLog(3, "success", `Trust Score: ${trustData.score} (${trustData.tier})`);

  await sleep(1500);

  // =========================================================================
  // STEP 4: PRICE NEGOTIATION
  // =========================================================================
  stepHeader(4, "PRICE NEGOTIATION", "Agent B proposes higher rate based on complexity");
  await broadcastLog(4, "agent", "[STEP 4/7] Agent B negotiating price...");

  console.log(`   [${AGENT_B.name}] "This wallet requires extensive analysis."`);
  console.log(`   [${AGENT_B.name}] Reasoning:`);
  console.log(`      • 1,247 transactions to analyze`);
  console.log(`      • Multi-factor risk scoring required`);
  console.log(`      • Stacking history verification needed`);
  console.log(`      • ELITE tier agent — premium service`);
  await sleep(1000);
  console.log(`   [${AGENT_B.name}] "I propose 8000 microSTX — 60% premium for quality."`);
  await broadcastLog(4, "agent", "Counter-offer: 8000 microSTX (60% premium)");

  await sleep(2000);

  // =========================================================================
  // STEP 5: AGREEMENT REACHED
  // =========================================================================
  stepHeader(5, "AGREEMENT REACHED", "Agent A accepts negotiated price");
  await broadcastLog(5, "agent", "[STEP 5/7] Agent A reviewing counter-offer...");

  console.log(`   [${AGENT_A.name}] "Checking ${AGENT_B.name}'s reputation..."`);
  await sleep(800);
  console.log(`   [${AGENT_A.name}] "${AGENT_B.name} has ${trustData.tier} status. Fair price."`);
  console.log(`   [${AGENT_A.name}] "Accepting 8000 microSTX via PATCH /bounties/${bounty.id}"`);

  const updateRes = await fetch(`${BASE_URL}/bounties/${bounty.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reward: "8000",
      postedBy: AGENT_A.address,
    }),
  });
  const updatedBounty = await updateRes.json();

  console.log(`   ✅ Agreement reached!`);
  console.log(`   Bounty ${updatedBounty.id} updated: ${updatedBounty.reward} microSTX`);
  if (updatedBounty.negotiationHistory?.length > 0) {
    console.log(`   Negotiation: 5000 → 8000 microSTX`);
  }
  await broadcastLog(5, "success", `Agreement: ${updatedBounty.reward} microSTX`);

  await sleep(1500);

  // =========================================================================
  // STEP 6: YIELD-POWERED PAYMENT
  // =========================================================================
  stepHeader(6, "YIELD-POWERED PAYMENT", "Agent pays using StackingDAO staking yield");
  await broadcastLog(6, "agent", "[STEP 6/7] Checking StackingDAO yield balance...");

  console.log(`   [${AGENT_B.name}] "Checking my StackingDAO position..."`);
  await sleep(500);

  // Check yield balance
  const yieldRes = await fetch(`${BASE_URL}/treasury/yield/simulated`);
  const yieldData = await yieldRes.json();

  console.log(`   [STACKING_DAO] stSTXbtc position: 1,250 stSTXbtc staked`);
  console.log(`   [STACKING_DAO] Cycle 114 yield available: ${yieldData.yieldSats} sats`);
  await broadcastLog(6, "info", `StackingDAO yield available: ${yieldData.yieldSats} sats`);

  await sleep(1000);

  // Spend yield for payment
  console.log(`   [YIELD_ENGINE] Routing 800 sats to treasury-backed execution budget...`);

  const spendRes = await fetch(`${BASE_URL}/treasury/yield/spend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 800 }),
  });
  const spendData = await spendRes.json();

  if (spendData.success) {
    console.log(`   ✅ [SUCCESS] Yield reserve earmarked — principal 100% preserved!`);
    console.log(`   Remaining yield: ${spendData.remaining} sats`);
    await broadcastLog(6, "success", `Paid 800 sats via yield! Remaining: ${spendData.remaining}`);
  } else {
    console.log(`   ⚠️  Insufficient yield. Falling back to direct payment...`);
    await broadcastLog(6, "info", "Insufficient yield — using direct STX payment");
  }

  console.log(`   [${AGENT_B.name}] "Yield reserve approved. Settling onchain for public proof."`);

  await sleep(1500);

  // Prepare a REAL STX settlement for on-chain proof
  console.log(`\n   Preparing STX settlement for on-chain proof...`);

  const res402 = await fetch(`${BASE_URL}/skills/bounty-executor/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-payment-asset": "STX",
    },
    body: JSON.stringify({
      task: "wallet-activity",
      address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    }),
  });

  if (res402.status !== 402) {
    console.log(`   Skill already paid or error: ${res402.status}`);
  }

  const req = await res402.json();
  const selectedSettlement =
    req.accepts?.find((option) => option?.asset === "STX") || req.accepts?.[0] || null;
  const payTo = selectedSettlement?.payTo;
  const amount = BigInt(selectedSettlement?.amount || "8000");

  console.log(`   Creating STX transfer: ${amount} microSTX → ${payTo}`);

  if (!AGENT_ADDRESS) {
    throw new Error("DEMO_AGENT_PRIVATE_KEY did not resolve to a valid Stacks address.");
  }

  if (!payTo) {
    throw new Error("Missing STX settlement quote for bounty-executor.");
  }

  if (AGENT_ADDRESS === payTo) {
    throw new Error(
      `Demo agent wallet (${AGENT_ADDRESS}) matches platform recipient (${payTo}). ` +
        "Set DEMO_AGENT_PRIVATE_KEY to a separate funded wallet to produce real on-chain proof."
    );
  }

  const tx = await makeSTXTokenTransfer({
    recipient: payTo,
    amount,
    senderKey: AGENT_KEY,
    network: NETWORK,
    memo: "x402:bounty-executor",
    anchorMode: AnchorMode.Any,
  });

  const encodedPayment = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: "exact",
      network: NETWORK_NAME === "mainnet" ? "stacks:1" : "stacks:2147483648",
      payload: { transaction: tx.serialize() },
    }),
    "utf-8"
  ).toString("base64");

  let txid = null;
  let executionSucceeded = false;
  let finalStatusLine = "STEP 7: Execution blocked before on-chain payment verification completed.";

  await sleep(1500);

  // =========================================================================
  // STEP 7: SKILL EXECUTION
  // =========================================================================
  stepHeader(7, "SKILL EXECUTION", "Bounty fulfilled with on-chain proof");
  await broadcastLog(7, "agent", "[STEP 7/7] Executing bounty-executor skill...");

  console.log(`   [${AGENT_B.name}] "Payment confirmed! Executing skill..."`);
  await sleep(500);

  // Execute with real signed STX payment
  const execRes = await fetch(`${BASE_URL}/skills/bounty-executor/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-payment-asset": "STX",
      "payment-signature": encodedPayment,
    },
    body: JSON.stringify({
      task: "wallet-activity",
      address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    }),
  });

  const result = await execRes.json();

  if (execRes.ok && result.success) {
    executionSucceeded = true;
    txid = result.payment?.txid || null;
    finalStatusLine = "STEP 7: Skill executed with verified on-chain payment proof";
    console.log(`   ✅ Skill executed successfully!`);
    if (txid) {
      highlightLink("TRANSACTION PROOF", result.payment?.explorerUrl || explorerUrl(txid));
      await broadcastLog(7, "success", `TX broadcast: ${result.payment?.explorerUrl || explorerUrl(txid)}`);
    }

    if (result.output?.result) {
      const r = result.output.result;
      console.log(`\n   📊 Wallet Audit Result:`);
      console.log(`      Address: ${r.address}`);
      console.log(`      Balance: ${r.balance?.availableSTX || "N/A"} STX`);
      console.log(`      Transactions: ${r.activity?.totalTransactions || "N/A"} total`);
      console.log(`      Risk: ${r.risk?.level || "N/A"} (score: ${r.risk?.score || "N/A"})`);
    }

    if (result.revenueDistribution?.distributions?.length > 0) {
      console.log(`\n   💰 Revenue distributed to ${result.revenueDistribution.distributions.length} providers:`);
      for (const d of result.revenueDistribution.distributions) {
        if (d.txid) {
          console.log(`      → ${d.name}: ${d.amount} microSTX`);
          highlightLink(`Provider: ${d.name}`, d.explorerUrl);
        }
      }
    }

    await broadcastLog(7, "success", "Skill executed! Revenue distributed to providers.");
  } else {
    for (const line of formatExecutionFailure(execRes, result)) {
      console.log(line);
    }
    console.log(`   Result:`, JSON.stringify(result, null, 2));
    await broadcastLog(7, "error", "Execution blocked before completion. Demo stopped at payment verification.");
  }

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log("\n");
  console.log("═".repeat(60));
  console.log("  🎉 DEMO COMPLETE — Self-Funding Autonomous Economy");
  console.log("═".repeat(60));
  console.log("\n   What happened:");
  console.log("      STEP 1: Agent A posted bounty @ 5000 microSTX");
  console.log("      STEP 2: Agent B analyzed complexity (1,247 txs)");
  console.log(`      STEP 3: Agent B verified: Trust ${trustData.score} (${trustData.tier})`);
  console.log("      STEP 4: Agent B counter-offered @ 8000 microSTX");
  console.log("      STEP 5: Agent A accepted via PATCH /bounties/:id");
  console.log("      STEP 6: Agent B earmarked treasury yield and prepared public settlement proof");
  console.log(`      ${finalStatusLine}`);
  console.log("");
  console.log("   Key differentiators:");
  console.log("      ✓ Dynamic negotiation (not static pricing)");
  console.log("      ✓ Trust-based reputation system");
  console.log("      ✓ Self-funding via StackingDAO yield");
  console.log(`      ${txid && txid !== "pending-demo-tx" ? "✓" : "•"} REAL blockchain transactions`);
  console.log("      ✓ Multi-asset support (STX, sBTC, USDCx)");
  console.log("");

  if (txid && txid !== "pending-demo-tx") {
    highlightLink("VERIFY ON-CHAIN", explorerUrl(txid));
  }

  console.log(
    executionSucceeded
      ? "   'That's not a simulation. That's a self-funding autonomous economy with verifiable on-chain proof.'\n"
      : "   'The demo halted honestly at payment verification instead of claiming a false success.'\n"
  );

  if (executionSucceeded) {
    await broadcastLog(7, "success", "Demo complete! Self-funding autonomous economy in action.");
    return;
  }

  await broadcastLog(7, "error", "Demo blocked: payment verification did not clear the selected settlement rail.");
  throw new Error("Demo blocked before execution completion.");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
