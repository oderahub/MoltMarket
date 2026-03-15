/**
 * paymentGate.js — Express middleware using x402-stacks library.
 *
 * Integrates the official x402-stacks package with MoltMarket extensions:
 * - WebSocket logging (broadcasts to UI terminal)
 * - Multi-asset pricing (STX + sBTC on same endpoint)
 * - Dynamic pricing for negotiated bounties
 */

import {
  paymentMiddleware,
  getPayment,
  STXtoMicroSTX,
  BTCtoSats,
  getDefaultSBTCContract,
  getExplorerURL,
} from "x402-stacks";
import config from "../config.js";
import log from "../utils/logger.js";
import {
  buildPaymentRequired,
  buildPaymentResponse,
  getPaymentFailureReason,
  getExplorerTxUrl,
  isExecutionUnlockedPayment,
  resolveSettlementQuote,
  PAYMENT_RESPONSE_HEADER,
} from "../utils/x402.js";
import { markIntentPaymentRequired } from "../services/intents.js";
import { spendSimulatedYield } from "../services/treasury.js";

// Default facilitator URL from x402-stacks
const DEFAULT_FACILITATOR = "https://x402-backend-7eby.onrender.com";
const YIELD_PAYMENT_ELIGIBLE_ASSET = "sBTC";

/**
 * Creates an Express middleware that gates a route behind x402 payment.
 * Uses x402-stacks library with MoltMarket extensions.
 *
 * @param {Object} options
 * @param {string|number} options.price - Required payment in microSTX (default)
 * @param {string} [options.description] - Human-readable description
 * @param {string} [options.asset="STX"] - Default token type
 * @param {Array} [options.acceptedAssets] - Multi-asset pricing options
 * @returns {Function} Express middleware function
 */
function readHeader(req, name) {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
}

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseUintLike(value) {
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (/^u\d+$/.test(text)) return text.slice(1);
  if (/^\d+$/.test(text)) return text;
  return null;
}

function parsePrincipalLike(value) {
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text || text === "none") return null;
  return text.startsWith("'") ? text.slice(1) : text;
}

function extractUintArg(arg) {
  if (!arg || typeof arg !== "object") return parseUintLike(arg);
  return parseUintLike(arg.repr) || parseUintLike(arg.value);
}

function extractPrincipalArg(arg) {
  if (!arg || typeof arg !== "object") return parsePrincipalLike(arg);
  return (
    normalizeString(arg.address) ||
    parsePrincipalLike(arg.repr) ||
    parsePrincipalLike(arg.value)
  );
}

function extractObservedSettlementDetails(txData) {
  if (txData?.tx_type === "token_transfer") {
    return {
      amount: normalizeString(txData.token_transfer?.amount),
      recipient: normalizeString(txData.token_transfer?.recipient_address),
      functionName: null,
    };
  }

  if (txData?.tx_type === "contract_call") {
    const functionArgs = Array.isArray(txData.contract_call?.function_args)
      ? txData.contract_call.function_args
      : [];

    return {
      amount: extractUintArg(functionArgs[0]),
      recipient: extractPrincipalArg(functionArgs[2]),
      functionName: normalizeString(txData.contract_call?.function_name),
    };
  }

  return {
    amount: null,
    recipient: null,
    functionName: normalizeString(txData?.contract_call?.function_name),
  };
}

function resolveDirectTxidIntentContext(req, intentId, selectedSettlement) {
  const stagedSettlement = req.intentRecord?.settlement?.selected || null;
  const intentLinkConfirmed = Boolean(
    intentId &&
      req.intentRecord?.status === "payment_required" &&
      stagedSettlement &&
      req.intentRecord?.skillId === req.skill?.id &&
      req.intentRecord?.settlement?.paymentRequestPath === req.originalUrl
  );

  return {
    intentLinkConfirmed,
    stagedSettlement,
    validationSettlement: intentLinkConfirmed ? stagedSettlement : selectedSettlement,
  };
}

function buildRejectedDirectTxidPayment({
  txid,
  selectedSettlement,
  payer,
  proofStatus,
  verificationDetails,
}) {
  return {
    txid,
    amount: selectedSettlement.amount,
    asset: selectedSettlement.asset,
    payer,
    explorerUrl: getExplorerTxUrl(txid),
    method: "direct-txid",
    verified: false,
    fundingSource: "principal",
    principalPreserved: false,
    proofStatus,
    verificationDetails,
    quote: selectedSettlement,
  };
}

function buildRejectedYieldPayment({
  txid,
  selectedSettlement,
  verificationDetails,
}) {
  return {
    txid,
    amount: selectedSettlement.amount,
    asset: selectedSettlement.asset,
    payer: "yield-engine",
    explorerUrl: null,
    yieldPowered: true,
    fundingSource: "yield",
    principalPreserved: true,
    method: "yield-payment",
    verified: false,
    proofStatus: "yield-helper",
    verificationDetails,
    quote: selectedSettlement,
  };
}

function rejectInvalidDirectTxidProof(req, res, options) {
  const { price, description, asset, acceptedAssets, intentId, selectedSettlement, payment } = options;
  const errorReason = getPaymentFailureReason(payment);

  log.warn("x402", `${errorReason} txid: ${payment.txid}`);
  res.set(
    PAYMENT_RESPONSE_HEADER,
    buildPaymentResponse({
      success: false,
      txid: payment.txid,
      asset: selectedSettlement.asset,
      intentId: intentId || "",
      errorReason,
    })
  );

  return handlePaymentRequired(req, res, {
    price,
    description,
    asset,
    acceptedAssets,
    intentId,
    selectedSettlement,
    paymentFailure: {
      ...payment,
      error: errorReason,
    },
  });
}

function rejectInvalidYieldPayment(req, res, options) {
  const {
    price,
    description,
    asset,
    acceptedAssets,
    intentId,
    selectedSettlement,
    payment,
    errorReason,
  } = options;

  log.warn("x402", `${errorReason} settlement: ${selectedSettlement.asset}`);
  res.set(
    PAYMENT_RESPONSE_HEADER,
    buildPaymentResponse({
      success: false,
      txid: payment.txid,
      asset: selectedSettlement.asset,
      intentId: intentId || "",
      errorReason,
    })
  );

  return handlePaymentRequired(req, res, {
    price,
    description,
    asset,
    acceptedAssets,
    intentId,
    selectedSettlement,
    paymentFailure: {
      ...payment,
      error: errorReason,
    },
  });
}

export function paymentGate({
  price,
  description = "",
  asset = "STX",
  acceptedAssets = null,
  intentId = null,
}) {
  // Wrap with MoltMarket extensions (logging, multi-asset, direct txid)
  return async (req, res, next) => {
    const selectedSettlement = resolveSettlementQuote({
      requestedAsset: readHeader(req, "x-payment-asset"),
      amount: price,
      asset,
      acceptedAssets,
      payTo: config.platformAddress,
    });

    // Check for YIELD PAYMENT (StackingDAO yield-powered)
    const yieldPayment = readHeader(req, "x-yield-payment");
    if (yieldPayment) {
      const spendAmount = Number(selectedSettlement.amount);

      if (selectedSettlement.asset !== YIELD_PAYMENT_ELIGIBLE_ASSET) {
        return rejectInvalidYieldPayment(req, res, {
          price,
          description,
          asset,
          acceptedAssets,
          intentId,
          selectedSettlement,
          payment: buildRejectedYieldPayment({
            txid: yieldPayment,
            selectedSettlement,
            verificationDetails: {
              source: "stacking-dao-yield",
              principalPreserved: true,
              explorerReady: false,
              selectedSettlementAsset: selectedSettlement.asset,
              eligibleSettlementAsset: YIELD_PAYMENT_ELIGIBLE_ASSET,
            },
          }),
          errorReason: "Yield-backed payment is only available for sBTC settlement quotes.",
        });
      }

      const spendResult = spendSimulatedYield(spendAmount);
      if (!spendResult.success) {
        return rejectInvalidYieldPayment(req, res, {
          price,
          description,
          asset,
          acceptedAssets,
          intentId,
          selectedSettlement,
          payment: buildRejectedYieldPayment({
            txid: yieldPayment,
            selectedSettlement,
            verificationDetails: {
              source: "stacking-dao-yield",
              principalPreserved: true,
              explorerReady: false,
              selectedSettlementAsset: selectedSettlement.asset,
              eligibleSettlementAsset: YIELD_PAYMENT_ELIGIBLE_ASSET,
              availableYield: spendResult.remaining,
              requestedAmount: spendAmount,
              neededAmount: spendResult.needed,
            },
          }),
          errorReason: "Insufficient simulated yield for the selected settlement amount.",
        });
      }

      log.success("x402", `[YIELD_ENGINE] Yield payment accepted: ${yieldPayment}`);

      // Attach payment info for yield payment
      req.x402 = {
        txid: yieldPayment,
        amount: selectedSettlement.amount,
        asset: selectedSettlement.asset,
        payer: "yield-engine",
        explorerUrl: null,
        yieldPowered: true,
        fundingSource: "yield",
        principalPreserved: true,
        method: "yield-payment",
        verified: true,
        proofStatus: "yield-helper",
        verificationDetails: {
          source: "stacking-dao-yield",
          principalPreserved: true,
          explorerReady: false,
          selectedSettlementAsset: selectedSettlement.asset,
          spentAmount: spendAmount,
          remainingYield: spendResult.remaining,
        },
        quote: selectedSettlement,
      };
      return next();
    }

    // Check for DIRECT TXID proof 
    const directTxid = readHeader(req, "x-payment-txid");
    if (directTxid) {
      log.info("x402", `Direct txid proof received: ${directTxid}`);
      const { intentLinkConfirmed, stagedSettlement, validationSettlement } =
        resolveDirectTxidIntentContext(req, intentId, selectedSettlement);

      // Verify txid exists on chain
      try {
        const verifyUrl = `https://api.${config.stacksNetwork === "mainnet" ? "" : "testnet."}hiro.so/extended/v1/tx/${directTxid}`;
        const verifyRes = await fetch(verifyUrl);

        if (verifyRes.ok) {
          const txData = await verifyRes.json();
          const expectedContract = validationSettlement.contractAddress || null;
          const observedContract = txData.contract_call?.contract_id || null;
          const observedSettlement = extractObservedSettlementDetails(txData);
          const assetMatchConfirmed = expectedContract
            ? observedContract === expectedContract
            : txData.tx_type === "token_transfer";
          const txStatusConfirmed = txData.tx_status === "success";
          const transferFunctionConfirmed = expectedContract
            ? observedSettlement.functionName === "transfer"
            : true;
          const amountMatchConfirmed = validationSettlement.amount
            ? observedSettlement.amount === String(validationSettlement.amount)
            : true;
          const payToMatchConfirmed = validationSettlement.payTo
            ? observedSettlement.recipient === validationSettlement.payTo
            : true;
          const proofStatus = !txStatusConfirmed
            ? "tx-status-not-success"
            : !intentLinkConfirmed
              ? "tx-found-intent-unconfirmed"
              : !assetMatchConfirmed
                ? "tx-found-asset-unconfirmed"
                : !transferFunctionConfirmed || !amountMatchConfirmed || !payToMatchConfirmed
                  ? "tx-found-quote-unconfirmed"
                  : "verified-onchain";

          const payment = proofStatus === "verified-onchain"
            ? {
                txid: directTxid,
                amount: validationSettlement.amount,
                asset: validationSettlement.asset,
                payer: txData.sender_address || "unknown",
                explorerUrl: getExplorerTxUrl(directTxid),
                method: "direct-txid",
                verified: true,
                fundingSource: "principal",
                principalPreserved: false,
                proofStatus,
                verificationDetails: {
                  txStatus: txData.tx_status,
                  txType: txData.tx_type,
                  expectedContract,
                  observedContract,
                  expectedAmount: String(validationSettlement.amount || ""),
                  observedAmount: observedSettlement.amount,
                  expectedRecipient: validationSettlement.payTo || null,
                  observedRecipient: observedSettlement.recipient,
                  observedFunctionName: observedSettlement.functionName,
                  assetMatchConfirmed,
                  amountMatchConfirmed,
                  payToMatchConfirmed,
                  transferFunctionConfirmed,
                  txStatusConfirmed,
                  intentLinkConfirmed,
                  stagedIntentId: stagedSettlement ? intentId : null,
                },
                quote: validationSettlement,
              }
            : buildRejectedDirectTxidPayment({
                txid: directTxid,
                selectedSettlement: validationSettlement,
                payer: txData.sender_address || "unknown",
                proofStatus,
                verificationDetails: {
                  txStatus: txData.tx_status,
                  txType: txData.tx_type,
                  expectedContract,
                  observedContract,
                  expectedAmount: String(validationSettlement.amount || ""),
                  observedAmount: observedSettlement.amount,
                  expectedRecipient: validationSettlement.payTo || null,
                  observedRecipient: observedSettlement.recipient,
                  observedFunctionName: observedSettlement.functionName,
                  assetMatchConfirmed,
                  amountMatchConfirmed,
                  payToMatchConfirmed,
                  transferFunctionConfirmed,
                  txStatusConfirmed,
                  intentLinkConfirmed,
                  stagedIntentId: stagedSettlement ? intentId : null,
                },
              });

          if (!isExecutionUnlockedPayment(payment)) {
            return rejectInvalidDirectTxidProof(req, res, {
              price,
              description,
              asset,
              acceptedAssets,
              intentId,
              selectedSettlement: validationSettlement,
              payment,
            });
          }

          log.success("x402", `Payment verified on-chain! Status: ${txData.tx_status}`);
          req.x402 = payment;
          return next();
        } else {
          return rejectInvalidDirectTxidProof(req, res, {
            price,
            description,
            asset,
            acceptedAssets,
            intentId,
            selectedSettlement: validationSettlement,
            payment: buildRejectedDirectTxidPayment({
              txid: directTxid,
              selectedSettlement: validationSettlement,
              payer: "pending",
              proofStatus: "pending-onchain",
              verificationDetails: {
                txStatus: "pending-or-not-found",
                expectedContract: validationSettlement.contractAddress || null,
                expectedAmount: String(validationSettlement.amount || ""),
                expectedRecipient: validationSettlement.payTo || null,
                httpStatus: verifyRes.status,
                intentLinkConfirmed,
                stagedIntentId: stagedSettlement ? intentId : null,
              },
            }),
          });
        }
      } catch (err) {
        return rejectInvalidDirectTxidProof(req, res, {
          price,
          description,
          asset,
          acceptedAssets,
          intentId,
            selectedSettlement: validationSettlement,
          payment: buildRejectedDirectTxidPayment({
            txid: directTxid,
              selectedSettlement: validationSettlement,
            payer: "unverified",
            proofStatus: "verification-unavailable",
            verificationDetails: {
              error: err.message,
                expectedContract: validationSettlement.contractAddress || null,
                expectedAmount: String(validationSettlement.amount || ""),
                expectedRecipient: validationSettlement.payTo || null,
                intentLinkConfirmed,
                stagedIntentId: stagedSettlement ? intentId : null,
            },
          }),
        });
      }
    }

    // Check if payment header exists for logging
    const hasPayment = readHeader(req, "payment-signature");

    if (!hasPayment) {
      log.info("x402", `No payment header on ${req.method} ${req.path}. Returning 402.`);
      if (intentId) res.set("x-intent-id", intentId);

      return handlePaymentRequired(req, res, {
        price,
        description,
        asset,
        acceptedAssets,
        intentId,
        selectedSettlement,
      });
    } else {
      log.info("x402", `Payment header received on ${req.method} ${req.path}. Verifying...`);
    }

    if (selectedSettlement.asset === "USDCx") {
      return res.status(400).json({
        error: "USDCx settlement currently expects x-payment-txid proof rather than payment-signature verification.",
        acceptedProofHeaders: ["x-payment-txid"],
        selectedSettlement,
      });
    }

    const middlewareConfig = {
      amount: BigInt(selectedSettlement.amount),
      address: config.platformAddress,
      network: config.stacksNetwork,
      facilitatorUrl: config.facilitatorUrl || DEFAULT_FACILITATOR,
      description,
      tokenType: selectedSettlement.asset === "sBTC" ? "sBTC" : "STX",
    };

    if (selectedSettlement.asset === "sBTC") {
      middlewareConfig.tokenContract = getDefaultSBTCContract(config.stacksNetwork);
    }

    const baseMiddleware = paymentMiddleware(middlewareConfig);

    // Use x402-stacks middleware
    baseMiddleware(req, res, (err) => {
      if (err) {
        log.error("x402", `Payment verification failed: ${err.message}`);
        return next(err);
      }

      // Get payment info from x402-stacks
      const payment = getPayment(req);

      if (payment) {
        log.success("x402", `Payment verified! txid: ${payment.transaction}`);

        // Attach payment info in our format for compatibility
        req.x402 = {
          txid: payment.transaction || payment.txid,
          amount: selectedSettlement.amount,
          asset: payment.asset || selectedSettlement.asset,
          payer: payment.payer,
          explorerUrl: getExplorerURL(payment.transaction || payment.txid, config.stacksNetwork),
          method: "payment-signature",
          verified: true,
          fundingSource: "principal",
          principalPreserved: false,
          proofStatus: "verified-onchain",
          verificationDetails: {
            settlementAsset: selectedSettlement.asset,
            txid: payment.transaction || payment.txid,
          },
          quote: selectedSettlement,
        };
      }

      next();
    });
  };
}

/**
 * Handle explicit payment requirements so clients receive the selected quote,
 * verifiable intent payload, and registry paths before settlement.
 */
function handlePaymentRequired(
  req,
  res,
  { price, description, asset, acceptedAssets, intentId, selectedSettlement, paymentFailure = null }
) {
  const paymentRequired = buildPaymentRequired({
    payTo: config.platformAddress,
    amount: price,
    resource: req.originalUrl,
    description,
    asset,
    acceptedAssets,
  });

  if (intentId) {
    const updatedIntent = markIntentPaymentRequired(intentId, {
      paymentRequestPath: req.originalUrl,
      selectedSettlement,
    });
    if (updatedIntent) req.intentRecord = updatedIntent;
  }

  if (intentId) {
    paymentRequired.intent = {
      id: intentId,
      registryPath: `/registry/intents/${intentId}`,
      attestationPath: `/registry/intents/${intentId}/attestation`,
    };
    res.set("x-intent-id", intentId);
  }

  if (req.intentRecord?.verifiableIntent) {
    paymentRequired.verifiableIntent = req.intentRecord.verifiableIntent;
    paymentRequired.registry = req.intentRecord.registry;
  }

  paymentRequired.settlement = {
    selected: selectedSettlement,
    acceptedProofHeaders:
      selectedSettlement.asset === "USDCx"
        ? ["x-payment-txid"]
        : selectedSettlement.asset === "sBTC"
          ? ["payment-signature", "x-payment-txid", "x-yield-payment"]
          : ["payment-signature", "x-payment-txid"],
  };

  if (paymentFailure) {
    paymentRequired.error = paymentFailure.error;
    paymentRequired.payment = {
      txid: paymentFailure.txid,
      asset: paymentFailure.asset,
      method: paymentFailure.method,
      verified: false,
      proofStatus: paymentFailure.proofStatus,
      verificationDetails: paymentFailure.verificationDetails || null,
      explorerUrl: paymentFailure.explorerUrl || null,
    };
  }

  // Set header as per x402 spec
  res.set("payment-required", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"));

  return res.status(402).json(paymentRequired);
}

/**
 * Re-export x402-stacks utilities for convenience
 */
export { getPayment, STXtoMicroSTX, BTCtoSats, getDefaultSBTCContract };
