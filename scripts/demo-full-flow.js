/**
 * demo-full-flow.js — Complete MoltMarket demo: core skills + bounty + ledger.
 *
 * Run while recording demo video.
 * Usage: npm run client:demo
 *
 * Prereqs: Server running, DEMO_AGENT_PRIVATE_KEY set, wallet funded.
 */

import pkg from "@stacks/transactions";
const { makeSTXTokenTransfer } = pkg;
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SERVER_URL || "http://localhost:3000";
const AGENT_KEY = process.env.DEMO_AGENT_PRIVATE_KEY;
const NETWORK = process.env.STACKS_NETWORK || "testnet";
const PLATFORM_ADDR = process.env.PLATFORM_ADDRESS;

async function payForSkill(skillId, input) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔧 Purchasing: ${skillId}`);
  console.log(`${"=".repeat(60)}\n`);

  // Get 402
  const res402 = await fetch(`${BASE_URL}/skills/${skillId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (res402.status !== 402) {
    console.error(`Expected 402, got ${res402.status}`);
    return null;
  }

  const req = await res402.json();
  const payTo = req.accepts[0].payTo;
  const amount = BigInt(req.accepts[0].amount);
  console.log(`   Price: ${amount} microSTX → ${payTo}`);

  // Create + sign tx
  const tx = await makeSTXTokenTransfer({
    recipient: payTo,
    amount,
    senderKey: AGENT_KEY,
    network: NETWORK,
    memo: `x402:${skillId}`,
  });

  const encoded = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: "exact",
      network: "stacks:1",
      payload: { transaction: tx.serialize() },
    }),
    "utf-8"
  ).toString("base64");

  // Pay + execute
  console.log("   Broadcasting payment & executing skill...");
  const res = await fetch(`${BASE_URL}/skills/${skillId}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "payment-signature": encoded,
    },
    body: JSON.stringify(input),
  });

  const result = await res.json();

  if (result.success) {
    console.log(`   ✅ Paid! txid: ${result.payment.txid}`);
    console.log(`   🔗 ${result.payment.explorerUrl}`);
    console.log(`   📊 Data source: ${result.output?.dataSource || "Hiro API"}`);

    if (result.revenueDistribution?.distributions?.length > 0) {
      console.log(`   📤 Revenue distributed:`);
      for (const d of result.revenueDistribution.distributions) {
        if (d.txid) console.log(`      → ${d.name}: ${d.amount} microSTX`);
      }
    }

    // Show a snippet of the output
    if (result.output?.audit) {
      const a = result.output.audit;
      console.log(`\n   📋 Wallet Audit Result:`);
      console.log(`      Address: ${a.address}`);
      console.log(`      Balance: ${a.balance?.availableSTX} STX (${a.balance?.isStacking ? "stacking" : "not stacking"})`);
      console.log(`      Transactions: ${a.activity?.totalTransactions} total`);
      console.log(`      Risk: ${a.risk?.level} (score: ${a.risk?.score})`);
      console.log(`      Tokens: ${a.tokens?.fungibleTokenCount} FT, ${a.tokens?.nftCount} NFT`);
    } else if (result.output?.snapshot) {
      const s = result.output.snapshot;
      console.log(`\n   📋 Chain Intel Result:`);
      console.log(`      Tip height: ${s.chainTip?.stacksTipHeight}`);
      console.log(`      Avg block time: ${s.blocks?.averageBlockTimeSeconds}s`);
      console.log(`      Mempool: ${s.mempool?.pendingCount} pending`);
      console.log(`      Recent volume: ${s.recentActivity?.totalVolumeSTX} STX`);
    } else if (result.output?.result) {
      console.log(`\n   📋 Bounty Result: (see full output in server logs)`);
    }
  } else {
    console.log(`   ❌ Failed:`, JSON.stringify(result, null, 2));
  }

  return result;
}

async function main() {
  console.log("🤖 MoltMarket — Full Demo: Bitcoin Intelligence Bounty Board");
  console.log("==============================================================\n");

  if (!AGENT_KEY) {
    console.error("❌ Set DEMO_AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  // Show marketplace
  console.log("📋 Marketplace Skills:\n");
  const skills = await (await fetch(`${BASE_URL}/skills`)).json();
  for (const s of skills.skills) {
    console.log(`   ${s.id} — ${s.name} — ${s.priceSTX} [${s.category}]`);
  }

  // Post a bounty first (free)
  console.log("\n📌 Posting a bounty...\n");
  const bountyRes = await fetch(`${BASE_URL}/bounties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Audit whale wallets",
      description: "Find the top 3 most active Stacks addresses and compare risk scores",
      reward: "50000 microSTX",
      postedBy: "orchestrator-moltbot",
    }),
  });
  const bounty = await bountyRes.json();
  console.log(`   ✅ Bounty posted: ${bounty.id} — "${bounty.title}"`);

  // Skill 1: Wallet Auditor (real on-chain data!)
  await payForSkill("wallet-auditor", {
    address: PLATFORM_ADDR || "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  });

  console.log("\n⏳ Waiting 3s (nonce spacing)...\n");
  await new Promise((r) => setTimeout(r, 3000));

  // Skill 2: Stacks Chain Intelligence (real on-chain data!)
  await payForSkill("stacks-intel", {});

  console.log("\n⏳ Waiting 3s...\n");
  await new Promise((r) => setTimeout(r, 3000));

  // Skill 3: Bounty Executor (orchestrates multiple API calls)
  await payForSkill("bounty-executor", {
    task: "chain-overview",
  });

  // Ledger summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Final Ledger Summary");
  console.log(`${"=".repeat(60)}\n`);

  const ledger = await (await fetch(`${BASE_URL}/ledger/summary`)).json();
  console.log(`   Payments:     ${ledger.totalPayments}`);
  console.log(`   Incoming:     ${ledger.totalIncomingMicroSTX} microSTX`);
  console.log(`   Distributed:  ${ledger.totalDistributedMicroSTX} microSTX`);
  console.log(`   Platform fee: ${ledger.platformBalanceMicroSTX} microSTX`);

  // Bounties check
  const bounties = await (await fetch(`${BASE_URL}/bounties`)).json();
  console.log(`\n   Bounties posted: ${bounties.count}`);

  console.log(`\n🎉 Demo complete!`);
  console.log(`All transactions visible: https://explorer.hiro.so/?chain=testnet\n`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
