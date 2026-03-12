/**
 * intents.js — Verifiable intent registry with JSON persistence.
 *
 * Tracks the lifecycle of backend skill execution intents so clients can:
 * - verify the quoted payment options that were presented,
 * - correlate a payment/txid with an execution request,
 * - inspect registry records after settlement completes.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import config from "../config.js";
import log from "../utils/logger.js";
import {
  getPaymentFailureReason,
  isExecutionUnlockedPayment,
  normalizeAcceptedAssets,
  resolvePaymentProofStatus,
} from "../utils/x402.js";

const INTENT_FILE =
  process.env.MOLTMARKET_INTENT_FILE || join(process.cwd(), "intents.json");
const REGISTRY_MODE = "api-attested";
const REGISTRY_ATTESTATION_MODE = "express-registry-api";
const INTENT_REGISTRY_CONTRACT = {
  identifier: config.intentRegistry.contractId,
  name: config.intentRegistry.contractName,
  path: config.intentRegistry.contractPath,
  network: config.intentRegistry.network,
  deploymentStatus: config.intentRegistry.deploymentStatus,
  deploymentTxid: config.intentRegistry.deploymentTxid,
  deploymentExplorerUrl: config.intentRegistry.deploymentExplorerUrl,
};

function loadIntents() {
  try {
    if (existsSync(INTENT_FILE)) {
      return JSON.parse(readFileSync(INTENT_FILE, "utf-8"));
    }
  } catch (err) {
    log.warn("IntentRegistry", `Failed to load intents: ${err.message}. Starting fresh.`);
  }
  return [];
}

function saveIntents(intents) {
  try {
    writeFileSync(INTENT_FILE, JSON.stringify(intents, null, 2), "utf-8");
  } catch (err) {
    log.error("IntentRegistry", `Failed to save intents: ${err.message}`);
  }
}

function normalizeForHash(value) {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) acc[key] = normalizeForHash(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeForHash(value)))
    .digest("hex");
}

function buildSettlementOptions(skill) {
  return normalizeAcceptedAssets({
    amount: skill.price,
    asset: skill.asset,
    acceptedAssets: skill.acceptedAssets,
    payTo: config.platformAddress,
  });
}

function getAssetDecimals(asset) {
  if (asset === "STX") return 6;
  if (asset === "sBTC") return 8;
  if (asset === "USDCx") return 6;
  return null;
}

function getProofHeaders(asset) {
  if (asset === "USDCx") return ["x-payment-txid"];
  if (asset === "sBTC") return ["payment-signature", "x-payment-txid", "x-yield-payment"];
  return ["payment-signature", "x-payment-txid"];
}

function buildRegistryPaths(intentId) {
  return {
    intentPath: `/registry/intents/${intentId}`,
    attestationPath: `/registry/intents/${intentId}/attestation`,
    settlementsPath: `/registry/settlements?intentId=${intentId}`,
    contract: INTENT_REGISTRY_CONTRACT,
  };
}

function buildSpendLimits(settlementOptions = []) {
  return settlementOptions.map((option) => ({
    asset: option.asset,
    maxAmount: String(option.amount),
    payTo: option.payTo || config.platformAddress,
    network: option.network,
    tokenType: option.tokenType || (option.asset === "STX" ? "native" : null),
    decimals: option.decimals ?? getAssetDecimals(option.asset),
    contractAddress: option.contractAddress || null,
    maxTimeoutSeconds: option.maxTimeoutSeconds || null,
    ...(option.display ? { display: option.display } : {}),
    acceptedProofHeaders: getProofHeaders(option.asset),
  }));
}

function buildAttestation(intent) {
  const payload = {
    intentId: intent.id,
    skillId: intent.skillId,
    status: intent.status,
    request: intent.request,
    verification: intent.verification,
    payment: intent.settlement?.payment
      ? {
          txid: intent.settlement.payment.txid || "",
          asset: intent.settlement.payment.asset,
          amount: intent.settlement.payment.amount,
          method: intent.settlement.payment.method,
          fundingSource: intent.settlement.payment.fundingSource,
          principalPreserved: intent.settlement.payment.principalPreserved,
          proofStatus: intent.settlement.payment.proofStatus,
        }
      : null,
  };

  return {
    version: 1,
    type: "backend-intent-attestation",
    mode: REGISTRY_MODE,
    helper: REGISTRY_ATTESTATION_MODE,
    status: intent.settlement?.payment ? "ready" : "pending-payment",
    digest: digest(payload),
    registry: buildRegistryPaths(intent.id),
    notes: [
      "Intent and attestation records are served by the Express registry API for the live hero flow.",
      `Deployed Stacks ${INTENT_REGISTRY_CONTRACT.network} contract reference: ${INTENT_REGISTRY_CONTRACT.identifier}.`,
      `Verify the contract publication at ${INTENT_REGISTRY_CONTRACT.deploymentExplorerUrl}.`,
    ],
    payload,
  };
}

function buildVerifiableIntent(intent) {
  const spendLimits = buildSpendLimits(intent.settlement?.options || []);
  return {
    version: 1,
    type: "verifiable-intent",
    intentId: intent.id,
    skillId: intent.skillId,
    skillName: intent.skillName,
    action: intent.action,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    request: intent.request,
    input: intent.input,
    metadata: intent.metadata,
    network: intent.settlement?.network || config.stacksNetwork,
    spendLimits,
    verification: intent.verification,
    registry: {
      ...buildRegistryPaths(intent.id),
      mode: REGISTRY_MODE,
      attestationMode: REGISTRY_ATTESTATION_MODE,
    },
  };
}

function refreshArtifacts(intent) {
  intent.registry = {
    ...buildRegistryPaths(intent.id),
    mode: REGISTRY_MODE,
    attestationMode: REGISTRY_ATTESTATION_MODE,
    attestationStatus: intent.settlement?.payment ? "ready" : "pending-payment",
  };
  intent.attestation = buildAttestation(intent);
  intent.verifiableIntent = buildVerifiableIntent(intent);
}

let intents = loadIntents();

export function getIntent(intentId) {
  return intents.find((intent) => intent.id === intentId) || null;
}

export function getIntentAttestation(intentId) {
  return getIntent(intentId)?.attestation || null;
}

export function listIntents(filters = {}) {
  return intents.filter((intent) => {
    if (filters.status && intent.status !== filters.status) return false;
    if (filters.skillId && intent.skillId !== filters.skillId) return false;
    if (filters.asset && intent.settlement?.payment?.asset !== filters.asset) return false;
    if (filters.txid && intent.settlement?.payment?.txid !== filters.txid) return false;
    return true;
  });
}

function persist(intent) {
  intent.updatedAt = new Date().toISOString();
  refreshArtifacts(intent);
  saveIntents(intents);
  return intent;
}

function updateIntent(intentId, mutate) {
  const intent = getIntent(intentId);
  if (!intent) return null;
  mutate(intent);
  return persist(intent);
}

export function createOrHydrateIntent({
  intentId,
  skill,
  input = {},
  request = {},
  metadata = {},
}) {
  const existing = intentId ? getIntent(intentId) : null;
  const settlementOptions = buildSettlementOptions(skill);

  if (existing) {
    const record = updateIntent(existing.id, (intent) => {
      intent.input = input;
      intent.request = { ...intent.request, ...request };
      intent.metadata = { ...intent.metadata, ...metadata };
      intent.settlement = { ...intent.settlement, options: settlementOptions };
      intent.verification = {
        ...intent.verification,
        inputDigest: digest(input),
        quoteDigest: digest(settlementOptions),
        intentDigest: digest({ skillId: skill.id, input, settlementOptions }),
      };
    });
    log.info("IntentRegistry", `Generated verifiable intent payload for ${record.id}`, record.verifiableIntent);
    return record;
  }

  const now = new Date().toISOString();
  const record = {
    id: intentId || `intent-${Date.now()}-${intents.length + 1}`,
    kind: "skill-execution",
    skillId: skill.id,
    skillName: skill.name,
    action: "execute",
    status: "created",
    createdAt: now,
    updatedAt: now,
    request,
    input,
    metadata,
    verification: {
      inputDigest: digest(input),
      quoteDigest: digest(settlementOptions),
      intentDigest: digest({ skillId: skill.id, input, settlementOptions }),
    },
    settlement: {
      network: config.stacksNetwork,
      options: settlementOptions,
      paymentRequestPath: request.path || null,
      payment: null,
    },
    execution: null,
  };

  intents.push(record);
  persist(record);
  log.info("IntentRegistry", `Created intent ${record.id} for ${skill.id}`);
  log.info("IntentRegistry", `Generated verifiable intent payload for ${record.id}`, record.verifiableIntent);
  return record;
}

export function markIntentPaymentRequired(intentId, details = {}) {
  return updateIntent(intentId, (intent) => {
    intent.status = "payment_required";
    intent.settlement = {
      ...intent.settlement,
      paymentRequestPath:
        details.paymentRequestPath || intent.settlement?.paymentRequestPath || null,
    };
  });
}

export function recordIntentSettlement(intentId, payment = {}) {
  return updateIntent(intentId, (intent) => {
    const fundingSource = payment.yieldPowered ? "yield" : "principal";
    const principalPreserved = Boolean(payment.yieldPowered);
    const proofStatus = resolvePaymentProofStatus(payment);
    const verified = isExecutionUnlockedPayment(payment);
    const currentStatus = intent.status === "completed" ? "completed" : "payment_required";

    intent.status = verified ? "settled" : currentStatus;
    intent.settlement = {
      ...intent.settlement,
      payment: {
        txid: payment.txid || "",
        asset: payment.asset || "STX",
        amount: String(payment.amount || "0"),
        payer: payment.payer || "unknown",
        method: payment.method || "unknown",
        verified,
        explorerUrl: payment.explorerUrl || null,
        yieldPowered: Boolean(payment.yieldPowered),
        fundingSource,
        principalPreserved,
        proofStatus,
        verificationDetails: payment.verificationDetails || null,
        quote: payment.quote || null,
        ...(verified
          ? { settledAt: new Date().toISOString() }
          : {
              rejectedAt: new Date().toISOString(),
              error: getPaymentFailureReason({ ...payment, proofStatus, verified }),
            }),
      },
    };
    intent.verification = {
      ...intent.verification,
      settlementDigest: digest(intent.settlement.payment),
    };
  });
}

export function completeIntent(intentId, { ledgerEntryId, paymentTxid, result, revenueDistribution }) {
  const intent = getIntent(intentId);
  if (!intent) return null;
  if (!isExecutionUnlockedPayment(intent.settlement?.payment)) {
    log.warn("IntentRegistry", `Refusing to complete ${intentId} without a verified payment proof.`);
    return intent;
  }

  return updateIntent(intentId, (intent) => {
    intent.status = "completed";
    intent.execution = {
      completedAt: new Date().toISOString(),
      ledgerEntryId,
      paymentTxid,
      resultDigest: digest(result),
      revenueDistributionDigest: digest(revenueDistribution || []),
    };
  });
}

export function failIntent(intentId, details = {}) {
  return updateIntent(intentId, (intent) => {
    intent.status = "failed";
    intent.execution = {
      failedAt: new Date().toISOString(),
      error: details.error || "Intent execution failed",
      paymentTxid: details.paymentTxid || "",
      stage: details.stage || "unknown",
    };
  });
}

export function getIntentRegistrySummary() {
  return intents.reduce(
    (summary, intent) => {
      summary.total += 1;
      summary.byStatus[intent.status] = (summary.byStatus[intent.status] || 0) + 1;
      return summary;
    },
    { total: 0, byStatus: {} }
  );
}