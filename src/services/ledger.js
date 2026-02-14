/**
 * ledger.js — Revenue tracking with JSON file persistence.
 *
 * UPGRADED: Ledger now persists to ledger.json so data survives
 * server restarts. Uses synchronous writes for simplicity.
 *
 * Tracks all incoming payments and outgoing provider distributions.
 * Multi-hop flow: Agent → Platform (full) → Platform keeps fee → Pays providers
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { sendSTX } from "../utils/stacks.js";
import config from "../config.js";
import log from "../utils/logger.js";

const LEDGER_FILE = join(process.cwd(), "ledger.json");

/**
 * Load ledger from disk, or return empty array if file doesn't exist.
 */
function loadLedger() {
  try {
    if (existsSync(LEDGER_FILE)) {
      const raw = readFileSync(LEDGER_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    log.warn("Ledger", `Failed to load ledger file: ${err.message}. Starting fresh.`);
  }
  return [];
}

/**
 * Save ledger to disk.
 */
function saveLedger(entries) {
  try {
    writeFileSync(LEDGER_FILE, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    log.error("Ledger", `Failed to save ledger: ${err.message}`);
  }
}

// In-memory ledger, initialized from disk
let entries = loadLedger();

/**
 * Records a payment received from an agent.
 */
export function recordIncomingPayment({ txid, from, amount, skillId, timestamp }) {
  const entry = {
    id: entries.length + 1,
    type: "incoming",
    txid,
    from,
    amount,
    skillId,
    timestamp: timestamp || new Date().toISOString(),
    distributions: [],
  };
  entries.push(entry);
  saveLedger(entries);
  log.info("Ledger", `Recorded incoming payment #${entry.id}`, { txid, amount, skillId });
  return entry;
}

/**
 * Records an outgoing distribution payment to a provider.
 */
export function recordDistribution({ ledgerEntryId, txid, toAddress, toName, amount }) {
  const entry = entries.find((e) => e.id === ledgerEntryId);
  if (entry) {
    entry.distributions.push({
      txid,
      toAddress,
      toName,
      amount,
      timestamp: new Date().toISOString(),
    });
    saveLedger(entries);
  }
  log.info("Ledger", `Recorded distribution from entry #${ledgerEntryId}`, { txid, toName, amount });
}

/**
 * Gets all ledger entries.
 */
export function getLedger() {
  return entries;
}

/**
 * Gets ledger summary statistics.
 */
export function getLedgerSummary() {
  let totalIncoming = 0n;
  let totalDistributed = 0n;

  for (const entry of entries) {
    totalIncoming += BigInt(entry.amount);
    for (const dist of entry.distributions) {
      totalDistributed += BigInt(dist.amount);
    }
  }

  return {
    totalPayments: entries.length,
    totalIncomingMicroSTX: totalIncoming.toString(),
    totalDistributedMicroSTX: totalDistributed.toString(),
    platformBalanceMicroSTX: (totalIncoming - totalDistributed).toString(),
    entries,
  };
}

/**
 * Records a negotiation event (bounty price change).
 * Shows price change history in ledger for transparency.
 */
export function recordNegotiation({ bountyId, oldReward, newReward, updatedBy }) {
  const entry = {
    id: entries.length + 1,
    type: "negotiation",
    bountyId,
    oldReward,
    newReward,
    updatedBy: updatedBy || "anonymous-agent",
    timestamp: new Date().toISOString(),
    distributions: [],
  };
  entries.push(entry);
  saveLedger(entries);
  log.info("Ledger", `Recorded negotiation #${entry.id}`, { bountyId, oldReward, newReward });
  return entry;
}

/**
 * Distributes revenue from an incoming payment to skill providers.
 * Multi-hop: Platform receives full amount → keeps fee → pays providers.
 */
export async function distributeRevenue({ ledgerEntryId, totalAmount, providers }) {
  const total = BigInt(totalAmount);
  const platformFee = (total * BigInt(config.platformFeePercent)) / 100n;
  const distributable = total - platformFee;

  log.info("Ledger", `Distributing revenue for entry #${ledgerEntryId}`, {
    totalAmount: total.toString(),
    platformFee: platformFee.toString(),
    distributable: distributable.toString(),
  });

  const results = [];

  for (const provider of providers) {
    if (!provider.address) {
      log.warn("Ledger", `Skipping provider ${provider.name}: no address`);
      continue;
    }

    const providerAmount = (distributable * BigInt(provider.sharePercent)) / 100n;
    if (providerAmount <= 0n) continue;

    try {
      const result = await sendSTX({
        recipientAddress: provider.address,
        amount: providerAmount,
        senderKey: config.platformPrivateKey,
        memo: `moltmarket:${provider.name}`,
      });

      recordDistribution({
        ledgerEntryId,
        txid: result.txid,
        toAddress: provider.address,
        toName: provider.name,
        amount: providerAmount.toString(),
      });

      results.push({
        name: provider.name,
        txid: result.txid,
        amount: providerAmount.toString(),
        explorerUrl: result.explorerUrl,
      });

      log.success("Ledger", `Paid provider ${provider.name}: ${providerAmount} microSTX`);
    } catch (err) {
      log.error("Ledger", `Failed to pay provider ${provider.name}: ${err.message}`);
      results.push({ name: provider.name, error: err.message, amount: providerAmount.toString() });
    }
  }

  return results;
}
