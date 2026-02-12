/**
 * x402.js — x402 protocol utilities.
 *
 * Implements the x402 payment protocol for Stacks:
 * - Building 402 Payment Required responses
 * - Encoding/decoding payment-signature headers
 * - Building payment-response headers
 *
 * Protocol reference (x402 V2):
 *   - Server → Client: HTTP 402 with JSON body containing payment requirements
 *   - Client → Server: "payment-signature" header with base64-encoded payment payload
 *   - Server → Client: "payment-response" header with base64-encoded settlement result
 *
 * Header names:
 *   - x402-stacks uses "payment-signature" (NOT "X-PAYMENT" which is Coinbase/EVM)
 *
 * Network identifier:
 *   - CAIP-2 format: "stacks:1" for mainnet
 *   - For testnet, we use "stacks:2147483648" (testnet chain ID) or "stacks:testnet"
 */

import config from "../config.js";

/**
 * The header name used to send payment from client to server.
 * x402-stacks ecosystem uses "payment-signature".
 */
export const PAYMENT_HEADER = "payment-signature";

/**
 * The header name used to send settlement response from server to client.
 */
export const PAYMENT_RESPONSE_HEADER = "payment-response";

/**
 * Builds the JSON body for an HTTP 402 Payment Required response.
 *
 * This tells the client exactly how to pay for the resource.
 * Supports multiple accepted assets (e.g., STX and sBTC).
 *
 * @param {Object} params
 * @param {string} params.payTo - Stacks address to receive payment
 * @param {string|number} params.amount - Default price in microSTX
 * @param {string} params.resource - The URL path being requested
 * @param {string} [params.description] - Human-readable description
 * @param {string} [params.asset="STX"] - Default token type
 * @param {Array} [params.acceptedAssets] - Multi-asset pricing options
 * @param {number} [params.maxTimeoutSeconds=300] - Max time for payment
 * @returns {Object} - x402 V2 payment requirements object
 *
 * Example output (multi-asset):
 * {
 *   "x402Version": 2,
 *   "resource": { "url": "/skills/alpha-leak/execute" },
 *   "accepts": [
 *     { "scheme": "exact", "network": "stacks:1", "amount": "10000", "asset": "STX", "payTo": "...", ... },
 *     { "scheme": "exact", "network": "stacks:1", "amount": "1000", "asset": "sBTC", "payTo": "...", ... }
 *   ]
 * }
 */
export function buildPaymentRequired({
  payTo,
  amount,
  resource,
  description = "",
  asset = "STX",
  acceptedAssets = null,
  maxTimeoutSeconds = 300,
}) {
  // Build accepts array — either from acceptedAssets or single asset
  let accepts;
  if (acceptedAssets && acceptedAssets.length > 0) {
    accepts = acceptedAssets.map((opt) => ({
      scheme: "exact",
      network: "stacks:1",
      amount: String(opt.amount),
      asset: opt.asset,
      payTo,
      maxTimeoutSeconds,
      // Include sBTC contract info for SIP-010 tokens
      ...(opt.asset === "sBTC" && {
        contractAddress: config.sbtcContract,
        tokenType: "sip-010",
      }),
    }));
  } else {
    accepts = [
      {
        scheme: "exact",
        network: "stacks:1",
        amount: String(amount),
        asset,
        payTo,
        maxTimeoutSeconds,
      },
    ];
  }

  return {
    x402Version: 2,
    resource: {
      url: resource,
      description,
    },
    accepts,
  };
}

/**
 * Encodes a payment payload object as a base64 string for use in headers.
 *
 * @param {Object} payload - The payment payload object
 * @returns {string} - Base64-encoded JSON string
 */
export function encodePaymentHeader(payload) {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf-8").toString("base64");
}

/**
 * Decodes a base64-encoded payment header back to an object.
 *
 * @param {string} headerValue - Base64-encoded string from payment-signature header
 * @returns {Object} - Decoded payment payload
 * @throws {Error} - If decoding or parsing fails
 */
export function decodePaymentHeader(headerValue) {
  try {
    const json = Buffer.from(headerValue, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch (err) {
    throw new Error(`Failed to decode payment header: ${err.message}`);
  }
}

/**
 * Builds a payment payload that a client would send in the payment-signature header.
 *
 * For Stacks, the payload contains a fully-signed serialized transaction.
 * This follows the Solana x402 pattern (signed tx in payload) rather than
 * the EVM pattern (EIP-3009 off-chain signature).
 *
 * @param {Object} params
 * @param {string} params.transactionHex - Hex-encoded signed Stacks transaction
 * @returns {Object} - Payment payload object (encode with encodePaymentHeader before sending)
 *
 * Example:
 * {
 *   "x402Version": 2,
 *   "scheme": "exact",
 *   "network": "stacks:1",
 *   "payload": {
 *     "transaction": "<hex-encoded-signed-stacks-transaction>"
 *   }
 * }
 */
export function buildPaymentPayload({ transactionHex }) {
  return {
    x402Version: 2,
    scheme: "exact",
    network: "stacks:1",
    payload: {
      transaction: transactionHex,
    },
  };
}

/**
 * Builds the settlement response that the server returns in the payment-response header.
 *
 * @param {Object} params
 * @param {boolean} params.success - Whether settlement succeeded
 * @param {string} [params.txid] - Transaction ID on blockchain
 * @param {string} [params.network="stacks:1"] - Network identifier
 * @param {string} [params.errorReason] - Error message if settlement failed
 * @returns {string} - Base64-encoded JSON string for the payment-response header
 */
export function buildPaymentResponse({
  success,
  txid = "",
  network = "stacks:1",
  errorReason = "",
}) {
  const responseObj = {
    success,
    txid,
    network,
  };
  if (!success && errorReason) {
    responseObj.errorReason = errorReason;
  }
  return encodePaymentHeader(responseObj);
}
