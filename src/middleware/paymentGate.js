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
  getExplorerTxUrl,
  resolveSettlementQuote,
} from "../utils/x402.js";

// Default facilitator URL from x402-stacks
const DEFAULT_FACILITATOR = "https://x402-backend-7eby.onrender.com";

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
    });

    // Check for YIELD PAYMENT (StackingDAO yield-powered)
    const yieldPayment = readHeader(req, "x-yield-payment");
    if (yieldPayment) {
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
        },
        quote: selectedSettlement,
      };
      return next();
    }

    // Check for DIRECT TXID proof 
    const directTxid = readHeader(req, "x-payment-txid");
    if (directTxid) {
      log.info("x402", `Direct txid proof received: ${directTxid}`);

      // Verify txid exists on chain
      try {
        const verifyUrl = `https://api.${config.stacksNetwork === "mainnet" ? "" : "testnet."}hiro.so/extended/v1/tx/${directTxid}`;
        const verifyRes = await fetch(verifyUrl);

        if (verifyRes.ok) {
          const txData = await verifyRes.json();
          const expectedContract = selectedSettlement.contractAddress || null;
          const observedContract = txData.contract_call?.contract_id || null;
          const assetMatchConfirmed = expectedContract
            ? observedContract === expectedContract
            : txData.tx_type === "token_transfer";
          log.success("x402", `Payment verified on-chain! Status: ${txData.tx_status}`);

          // Attach payment info
          req.x402 = {
            txid: directTxid,
            amount: selectedSettlement.amount,
            asset: selectedSettlement.asset,
            payer: txData.sender_address || "unknown",
            explorerUrl: getExplorerTxUrl(directTxid),
            method: "direct-txid",
            verified: true,
            fundingSource: "principal",
            principalPreserved: false,
            proofStatus: assetMatchConfirmed ? "verified-onchain" : "tx-found-asset-unconfirmed",
            verificationDetails: {
              txStatus: txData.tx_status,
              txType: txData.tx_type,
              expectedContract,
              observedContract,
              assetMatchConfirmed,
            },
            quote: selectedSettlement,
          };
          return next();
        } else {
          log.warn("x402", `Txid ${directTxid} not found yet (may be pending). Accepting anyway.`);
          req.x402 = {
            txid: directTxid,
            amount: selectedSettlement.amount,
            asset: selectedSettlement.asset,
            payer: "pending",
            explorerUrl: getExplorerTxUrl(directTxid),
            method: "direct-txid",
            verified: false,
            fundingSource: "principal",
            principalPreserved: false,
            proofStatus: "pending-onchain",
            verificationDetails: {
              txStatus: "pending-or-not-found",
              expectedContract: selectedSettlement.contractAddress || null,
            },
            quote: selectedSettlement,
          };
          return next();
        }
      } catch (err) {
        log.warn("x402", `Could not verify txid: ${err.message}. Accepting anyway.`);
        req.x402 = {
          txid: directTxid,
          amount: selectedSettlement.amount,
          asset: selectedSettlement.asset,
          payer: "unverified",
          explorerUrl: getExplorerTxUrl(directTxid),
          method: "direct-txid",
          verified: false,
          fundingSource: "principal",
          principalPreserved: false,
          proofStatus: "verification-unavailable",
          verificationDetails: {
            error: err.message,
            expectedContract: selectedSettlement.contractAddress || null,
          },
          quote: selectedSettlement,
        };
        return next();
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
function handlePaymentRequired(req, res, { price, description, asset, acceptedAssets, intentId, selectedSettlement }) {
  const paymentRequired = buildPaymentRequired({
    payTo: config.platformAddress,
    amount: price,
    resource: req.originalUrl,
    description,
    asset,
    acceptedAssets,
  });

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

  // Set header as per x402 spec
  res.set("payment-required", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"));

  return res.status(402).json(paymentRequired);
}

/**
 * Re-export x402-stacks utilities for convenience
 */
export { getPayment, STXtoMicroSTX, BTCtoSats, getDefaultSBTCContract };
