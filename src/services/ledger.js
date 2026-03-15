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
import config from "../config.js";
import log from "../utils/logger.js";

const LEDGER_FILE =
  process.env.MOLTMARKET_LEDGER_FILE || join(process.cwd(), "ledger.json");

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

function normalizeDistributionTxid(txid) {
  if (typeof txid === "string") return txid.trim();
  if (txid === null || txid === undefined) return "";
  return String(txid).trim();
}

export function resolveDistributionStatus({ status, txid, error } = {}) {
  const normalizedTxid = normalizeDistributionTxid(txid);

  if (status === "broadcasted") {
    return normalizedTxid ? "broadcasted" : error ? "failed" : "recorded";
  }

  if (status) return status;
  if (normalizedTxid) return "broadcasted";
  if (error) return "failed";
  return "recorded";
}

async function getStacksUtils() {
  return globalThis.__MOLTMARKET_STACKS_UTILS__ || import("../utils/stacks.js");
}

function buildBroadcastedDistribution({ provider, providerAmount, asset, txid, explorerUrl, note = "" }) {
  return {
    name: provider.name,
    txid,
    amount: providerAmount.toString(),
    asset,
    explorerUrl,
    status: resolveDistributionStatus({ txid }),
    ...(note ? { note } : {}),
  };
}

/**
 * Records a payment received from an agent.
 */
export function recordIncomingPayment({
  txid,
  from,
  amount,
  skillId,
  timestamp,
  asset = "STX",
  intentId = null,
  settlementMethod = "payment-signature",
  settlementDetails = null,
}) {
  const entry = {
    id: entries.length + 1,
    type: "incoming",
    txid,
    from,
    amount: String(amount),
    skillId,
    asset,
    intentId,
    settlementMethod,
    settlementDetails,
    network: config.stacksNetwork,
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
export function recordDistribution({
  ledgerEntryId,
  txid,
  toAddress,
  toName,
  amount,
  asset = "STX",
  status,
  explorerUrl = null,
  note = "",
  error = null,
}) {
  const normalizedTxid = normalizeDistributionTxid(txid);
  const normalizedStatus = resolveDistributionStatus({ status, txid: normalizedTxid, error });
  const entry = entries.find((e) => e.id === ledgerEntryId);
  if (entry) {
    entry.distributions.push({
      txid: normalizedTxid,
      toAddress,
      toName,
      amount: String(amount),
      asset,
      status: normalizedStatus,
      explorerUrl: normalizedTxid ? explorerUrl || null : null,
      note,
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

export function listSettlements(filters = {}) {
  return entries.filter((entry) => {
    if (entry.type !== "incoming") return false;
    if (filters.asset && entry.asset !== filters.asset) return false;
    if (filters.skillId && entry.skillId !== filters.skillId) return false;
    if (filters.intentId && entry.intentId !== filters.intentId) return false;
    if (filters.txid && entry.txid !== filters.txid) return false;
    return true;
  });
}

/**
 * Gets ledger summary statistics.
 */
export function getLedgerSummary() {
  let totalIncoming = 0n;
  let totalIncomingSTX = 0n;
  let totalDistributedSTX = 0n;
  const totalsByAsset = {};

  for (const entry of entries.filter((item) => item.type === "incoming")) {
    const incomingAsset = entry.asset || "STX";
    totalsByAsset[incomingAsset] = totalsByAsset[incomingAsset] || {
      incoming: 0n,
      distributed: 0n,
    };

    totalIncoming += BigInt(entry.amount);
    totalsByAsset[incomingAsset].incoming += BigInt(entry.amount);
    if (incomingAsset === "STX") totalIncomingSTX += BigInt(entry.amount);

    for (const dist of entry.distributions) {
      const distributionAsset = dist.asset || incomingAsset;
      totalsByAsset[distributionAsset] = totalsByAsset[distributionAsset] || {
        incoming: 0n,
        distributed: 0n,
      };
      totalsByAsset[distributionAsset].distributed += BigInt(dist.amount);
      if (distributionAsset === "STX") totalDistributedSTX += BigInt(dist.amount);
    }
  }

  return {
    totalPayments: listSettlements().length,
    totalIncomingMicroSTX: totalIncomingSTX.toString(),
    totalDistributedMicroSTX: totalDistributedSTX.toString(),
    platformBalanceMicroSTX: (totalIncomingSTX - totalDistributedSTX).toString(),
    totalsByAsset: Object.fromEntries(
      Object.entries(totalsByAsset).map(([asset, values]) => [
        asset,
        {
          incoming: values.incoming.toString(),
          distributed: values.distributed.toString(),
          platformBalance: (values.incoming - values.distributed).toString(),
        },
      ])
    ),
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
export async function distributeRevenue({ ledgerEntryId, totalAmount, providers, asset = "STX" }) {
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
      if (asset === "USDCx") {
        const { deriveAddressFromPrivateKey, sendUSDCx } = await getStacksUtils();
        const note = "Settled via USDCx SIP-010 transfer helper.";
        const result = await sendUSDCx({
          recipientAddress: provider.address,
          amount: providerAmount,
          senderKey: config.platformPrivateKey,
          senderAddress: deriveAddressFromPrivateKey(config.platformPrivateKey, config.stacksNetwork),
          memo: `moltmarket:${provider.name}`,
        });

        const txid = normalizeDistributionTxid(result?.txid);
        const explorerUrl = txid ? result?.explorerUrl || null : null;
        const status = resolveDistributionStatus({ txid });

        recordDistribution({
          ledgerEntryId,
          txid,
          toAddress: provider.address,
          toName: provider.name,
          amount: providerAmount.toString(),
          asset,
          status,
          explorerUrl,
          note,
        });

        results.push(buildBroadcastedDistribution({
          provider,
          providerAmount,
          asset,
          txid,
          explorerUrl,
          note,
        }));

        if (status === "broadcasted") {
          log.success("Ledger", `Paid provider ${provider.name}: ${providerAmount} ${asset}`);
        } else {
          log.warn("Ledger", `Recorded ${asset} payout for ${provider.name} without broadcast evidence.`);
        }
        continue;
      }

      if (asset === "sBTC") {
        const { deriveAddressFromPrivateKey, sendSBTC } = await getStacksUtils();
        const note = "Settled via sBTC SIP-010 transfer helper.";
        const result = await sendSBTC({
          recipientAddress: provider.address,
          amount: providerAmount,
          senderKey: config.platformPrivateKey,
          senderAddress: deriveAddressFromPrivateKey(config.platformPrivateKey, config.stacksNetwork),
          memo: `moltmarket:${provider.name}`,
        });

        const txid = normalizeDistributionTxid(result?.txid);
        const explorerUrl = txid ? result?.explorerUrl || null : null;
        const status = resolveDistributionStatus({ txid });

        recordDistribution({
          ledgerEntryId,
          txid,
          toAddress: provider.address,
          toName: provider.name,
          amount: providerAmount.toString(),
          asset,
          status,
          explorerUrl,
          note,
        });

        results.push(buildBroadcastedDistribution({
          provider,
          providerAmount,
          asset,
          txid,
          explorerUrl,
          note,
        }));

        if (status === "broadcasted") {
          log.success("Ledger", `Paid provider ${provider.name}: ${providerAmount} ${asset}`);
        } else {
          log.warn("Ledger", `Recorded ${asset} payout for ${provider.name} without broadcast evidence.`);
        }
        continue;
      }

      if (asset !== "STX") {
        const note = `Provider payout recorded for ${asset}; automatic settlement is only implemented for STX, sBTC, and USDCx.`;
        recordDistribution({
          ledgerEntryId,
          txid: "",
          toAddress: provider.address,
          toName: provider.name,
          amount: providerAmount.toString(),
          asset,
          status: "recorded",
          note,
        });

        results.push({
          name: provider.name,
          amount: providerAmount.toString(),
          asset,
          status: "recorded",
          note,
        });
        log.warn("Ledger", `${note} (${provider.name})`);
        continue;
      }

      const { sendSTX } = await import("../utils/stacks.js");
      const result = await sendSTX({
        recipientAddress: provider.address,
        amount: providerAmount,
        senderKey: config.platformPrivateKey,
        memo: `moltmarket:${provider.name}`,
      });

      const txid = normalizeDistributionTxid(result?.txid);
      const explorerUrl = txid ? result?.explorerUrl || null : null;
      const status = resolveDistributionStatus({ txid });

      recordDistribution({
        ledgerEntryId,
        txid,
        toAddress: provider.address,
        toName: provider.name,
        amount: providerAmount.toString(),
        asset,
        status,
        explorerUrl,
      });

      results.push({
        name: provider.name,
        txid,
        amount: providerAmount.toString(),
        asset,
        explorerUrl,
        status,
      });

      if (status === "broadcasted") {
        log.success("Ledger", `Paid provider ${provider.name}: ${providerAmount} microSTX`);
      } else {
        log.warn("Ledger", `Recorded STX payout for ${provider.name} without broadcast evidence.`);
      }
    } catch (err) {
      log.error("Ledger", `Failed to pay provider ${provider.name}: ${err.message}`);
      results.push({
        name: provider.name,
        error: err.message,
        amount: providerAmount.toString(),
        asset,
        status: resolveDistributionStatus({ error: err.message }),
        note: `Provider payout failed: ${err.message}`,
      });
    }
  }

  return results;
}
