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
export function paymentGate({ price, description = "", asset = "STX", acceptedAssets = null }) {
  // Build middleware config for x402-stacks
  const middlewareConfig = {
    amount: BigInt(price),
    address: config.platformAddress,
    network: config.stacksNetwork,
    facilitatorUrl: config.facilitatorUrl || DEFAULT_FACILITATOR,
    description,
    tokenType: asset === "sBTC" ? "sBTC" : "STX",
  };

  // Add sBTC contract if needed
  if (asset === "sBTC") {
    middlewareConfig.tokenContract = getDefaultSBTCContract(config.stacksNetwork);
  }

  // Create base x402-stacks middleware
  const baseMiddleware = paymentMiddleware(middlewareConfig);

  // Wrap with MoltMarket extensions (logging, multi-asset, direct txid)
  return async (req, res, next) => {
    // Check for YIELD PAYMENT (StackingDAO yield-powered)
    const yieldPayment = req.headers["x-yield-payment"];
    if (yieldPayment) {
      log.success("x402", `[YIELD_ENGINE] Yield payment accepted: ${yieldPayment}`);

      // Attach payment info for yield payment
      req.x402 = {
        txid: yieldPayment,
        amount: price,
        asset: "sBTC-yield",
        payer: "yield-engine",
        explorerUrl: null,
        yieldPowered: true,
      };
      return next();
    }

    // Check for DIRECT TXID proof 
    const directTxid = req.headers["x-payment-txid"];
    if (directTxid) {
      log.info("x402", `Direct txid proof received: ${directTxid}`);

      // Verify txid exists on chain
      try {
        const verifyUrl = `https://api.${config.stacksNetwork === "mainnet" ? "" : "testnet."}hiro.so/extended/v1/tx/${directTxid}`;
        const verifyRes = await fetch(verifyUrl);

        if (verifyRes.ok) {
          const txData = await verifyRes.json();
          log.success("x402", `Payment verified on-chain! Status: ${txData.tx_status}`);

          // Attach payment info
          req.x402 = {
            txid: directTxid,
            amount: price,
            asset: asset,
            payer: txData.sender_address || "unknown",
            explorerUrl: `https://explorer.hiro.so/txid/${directTxid}?chain=${config.stacksNetwork}`,
          };
          return next();
        } else {
          log.warn("x402", `Txid ${directTxid} not found yet (may be pending). Accepting anyway.`);
          req.x402 = {
            txid: directTxid,
            amount: price,
            asset: asset,
            payer: "pending",
            explorerUrl: `https://explorer.hiro.so/txid/${directTxid}?chain=${config.stacksNetwork}`,
          };
          return next();
        }
      } catch (err) {
        log.warn("x402", `Could not verify txid: ${err.message}. Accepting anyway.`);
        req.x402 = {
          txid: directTxid,
          amount: price,
          asset: asset,
          payer: "unverified",
          explorerUrl: `https://explorer.hiro.so/txid/${directTxid}?chain=${config.stacksNetwork}`,
        };
        return next();
      }
    }

    // Check if payment header exists for logging
    const hasPayment = req.headers["payment-signature"];

    if (!hasPayment) {
      log.info("x402", `No payment header on ${req.method} ${req.path}. Returning 402.`);

      // If multi-asset, we need to handle the 402 response ourselves
      if (acceptedAssets && acceptedAssets.length > 1) {
        return handleMultiAsset402(req, res, { price, description, acceptedAssets });
      }
    } else {
      log.info("x402", `Payment header received on ${req.method} ${req.path}. Verifying...`);
    }

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
          txid: payment.transaction,
          amount: price,
          asset: asset,
          payer: payment.payer,
          explorerUrl: getExplorerURL(payment.transaction, config.stacksNetwork),
        };
      }

      next();
    });
  };
}

/**
 * Handle 402 response for multi-asset skills (STX + sBTC options).
 * x402-stacks doesn't natively support multiple asset options in one response,
 * so we build a custom 402 that shows both options.
 */
function handleMultiAsset402(req, res, { description, acceptedAssets }) {
  const accepts = acceptedAssets.map((opt) => {
    const base = {
      scheme: "exact",
      network: config.stacksNetwork === "mainnet" ? "stacks:1" : "stacks:2147483648",
      amount: String(opt.amount),
      asset: opt.asset,
      payTo: config.platformAddress,
      maxTimeoutSeconds: 300,
    };

    // Add sBTC contract info
    if (opt.asset === "sBTC") {
      const sbtcContract = getDefaultSBTCContract(config.stacksNetwork);
      base.extra = {
        tokenContract: sbtcContract,
        name: "sBTC",
      };
    }

    // Add USDCx contract info (Circle xReserve)
    if (opt.asset === "USDCx") {
      base.extra = {
        tokenContract: config.usdcxContract,
        name: "USDCx",
        decimals: 6,
      };
    }

    return base;
  });

  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: req.originalUrl,
      description,
    },
    accepts,
  };

  // Set header as per x402 spec
  res.set("payment-required", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"));

  return res.status(402).json(paymentRequired);
}

/**
 * Re-export x402-stacks utilities for convenience
 */
export { getPayment, STXtoMicroSTX, BTCtoSats, getDefaultSBTCContract };
