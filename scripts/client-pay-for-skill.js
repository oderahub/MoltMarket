/**
 * client-pay-for-skill.js — Agent pays for and executes a skill via x402.
 *
 * CORE DEMO: Shows the full x402 payment → real on-chain data flow.
 *
 * Usage: npm run client:pay
 *
 * Env vars:
 *   DEMO_AGENT_PRIVATE_KEY — Agent's private key
 *   DEMO_AGENT_ADDRESS     — Agent's Stacks testnet address
 *   SKILL_ID               — Skill to buy (default: wallet-auditor)
 *   TARGET_ADDRESS         — Address to audit (default: platform address)
 *   SERVER_URL             — Server URL (default: http://localhost:3000)
 */

import pkg from "@stacks/transactions";
const { makeSTXTokenTransfer } = pkg;
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SERVER_URL || "http://localhost:3000";
const AGENT_KEY = process.env.DEMO_AGENT_PRIVATE_KEY;
const AGENT_ADDRESS = process.env.DEMO_AGENT_ADDRESS;
const SKILL_ID = process.env.SKILL_ID || "wallet-auditor";
const NETWORK = process.env.STACKS_NETWORK || "testnet";
// Default to auditing the platform's own wallet (always has activity)
const TARGET_ADDRESS = process.env.TARGET_ADDRESS || process.env.PLATFORM_ADDRESS;

async function main() {
  console.log("🤖 MoltMarket Agent — Payment Flow");
  console.log("====================================\n");

  if (!AGENT_KEY || !AGENT_ADDRESS) {
    console.error("❌ Missing DEMO_AGENT_PRIVATE_KEY or DEMO_AGENT_ADDRESS.");
    console.error("   Run: npm run setup:wallets");
    process.exit(1);
  }

  console.log(`Agent:   ${AGENT_ADDRESS}`);
  console.log(`Skill:   ${SKILL_ID}`);
  console.log(`Target:  ${TARGET_ADDRESS || "(none — skill will use defaults)"}`);
  console.log(`Server:  ${BASE_URL}\n`);

  // Build skill-specific input
  const inputBody = {};
  if (SKILL_ID === "wallet-auditor") {
    inputBody.address = TARGET_ADDRESS;
  } else if (SKILL_ID === "stacks-intel") {
    // No input needed — fetches live chain data
  } else if (SKILL_ID === "bounty-executor") {
    inputBody.task = "chain-overview";
  }

  // Step 1: Get 402
  console.log("📋 Step 1: Requesting skill (no payment)...\n");
  const res402 = await fetch(`${BASE_URL}/skills/${SKILL_ID}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inputBody),
  });

  if (res402.status !== 402) {
    console.error(`Expected 402, got ${res402.status}`);
    console.error(await res402.text());
    process.exit(1);
  }

  const requirements = await res402.json();
  const payTo = requirements.accepts[0].payTo;
  const amount = BigInt(requirements.accepts[0].amount);
  console.log(`✅ 402 received: ${amount} microSTX → ${payTo}\n`);

  // Step 2: Create transaction
  console.log("🔐 Step 2: Creating STX transfer...\n");
  let transaction;
  try {
    transaction = await makeSTXTokenTransfer({
      recipient: payTo,
      amount,
      senderKey: AGENT_KEY,
      network: NETWORK,
      memo: `x402:${SKILL_ID}`,
    });
    console.log("✅ Transaction signed!\n");
  } catch (err) {
    console.error(`❌ Failed: ${err.message}`);
    console.error("   Fund your agent wallet: https://platform.hiro.so/faucet");
    process.exit(1);
  }

  const txHex = transaction.serialize();

  // Step 3: Build payment header
  console.log("📦 Step 3: Building x402 payment payload...\n");
  const paymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: "stacks:1",
    payload: { transaction: txHex },
  };
  const encoded = Buffer.from(JSON.stringify(paymentPayload), "utf-8").toString("base64");

  // Step 4: Pay and execute
  console.log("💳 Step 4: Sending payment + executing skill...\n");
  const res200 = await fetch(`${BASE_URL}/skills/${SKILL_ID}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "payment-signature": encoded,
    },
    body: JSON.stringify(inputBody),
  });

  console.log(`HTTP Status: ${res200.status}`);
  const result = await res200.json();

  if (res200.status === 200 && result.success) {
    console.log("\n🎉 SUCCESS! Skill executed via x402!\n");
    console.log("💰 Payment:");
    console.log(`   txid: ${result.payment.txid}`);
    console.log(`   amount: ${result.payment.amount} microSTX`);
    console.log(`   explorer: ${result.payment.explorerUrl}\n`);

    if (result.revenueDistribution?.distributions?.length > 0) {
      console.log("📤 Multi-hop distribution:");
      for (const d of result.revenueDistribution.distributions) {
        if (d.txid) {
          console.log(`   → ${d.name}: ${d.amount} microSTX (${d.explorerUrl})`);
        } else if (d.error) {
          console.log(`   → ${d.name}: ❌ ${d.error}`);
        }
      }
      console.log("");
    }

    console.log("📊 Skill output (REAL on-chain data):");
    console.log(JSON.stringify(result.output, null, 2));
  } else {
    console.log("\n❌ Failed:", JSON.stringify(result, null, 2));
  }

  console.log("\n🏁 Done!\n");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
