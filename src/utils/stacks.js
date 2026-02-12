/**
 * stacks.js — Stacks blockchain transaction utilities.
 *
 * Wraps @stacks/transactions v7.x for:
 * - Generating wallets (private key + address)
 * - Creating and signing STX transfer transactions
 * - Broadcasting transactions to the network
 * - Deserializing transactions from hex (for server-side verification)
 * - Looking up transaction status via Hiro API
 *
 * All amounts are in microSTX (1 STX = 1,000,000 microSTX).
 * Testnet addresses start with "ST". Mainnet addresses start with "SP".
 *
 * Verified against:
 * - @stacks/transactions v7.3.0 npm docs
 * - Hiro docs: https://docs.hiro.so/stacks/stacks.js/packages/transactions
 * - Stacks.js reference: https://stacks.js.org/modules/transactions.html
 */

import pkg from "@stacks/transactions";
const {
  makeSTXTokenTransfer,
  makeContractCall,
  broadcastTransaction,
  deserializeTransaction,
  randomPrivateKey,
  getAddressFromPrivateKey,
  uintCV,
  standardPrincipalCV,
  noneCV,
  someCV,
  bufferCV,
  PostConditionMode,
  FungibleConditionCode,
  makeStandardFungiblePostCondition,
} = pkg;
import config from "../config.js";

// ---------------------------------------------------------------------------
// Wallet generation
// ---------------------------------------------------------------------------

/**
 * Generates a new random Stacks wallet (private key + address).
 *
 * @param {"testnet"|"mainnet"} network - Which network to derive the address for.
 * @returns {{ privateKey: string, address: string }}
 *
 * Note: privateKey is a 64-char hex string with a "01" suffix (compressed).
 * Testnet addresses start with "ST", mainnet with "SP".
 */
export function generateWallet(network = "testnet") {
  const privateKey = randomPrivateKey();
  const address = getAddressFromPrivateKey(privateKey, network);
  return { privateKey, address };
}

// ---------------------------------------------------------------------------
// Transaction creation & broadcasting
// ---------------------------------------------------------------------------

/**
 * Creates a signed STX token transfer transaction.
 *
 * @param {Object} params
 * @param {string} params.recipientAddress - Stacks address to send STX to
 * @param {bigint|number|string} params.amount - Amount in microSTX
 * @param {string} params.senderKey - Sender's private key (hex string)
 * @param {string} [params.memo] - Optional memo (max 34 bytes)
 * @param {bigint} [params.fee] - Optional fee in microSTX. Auto-estimated if omitted.
 * @returns {Promise<import("@stacks/transactions").StacksTransaction>}
 *
 * Usage:
 *   const tx = await createSTXTransfer({
 *     recipientAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
 *     amount: 5000n,
 *     senderKey: "b244296d...01",
 *     memo: "x402-payment",
 *   });
 */
export async function createSTXTransfer({
  recipientAddress,
  amount,
  senderKey,
  memo = "",
  fee,
}) {
  const txOptions = {
    recipient: recipientAddress,
    amount: BigInt(amount),
    senderKey,
    network: config.stacksNetwork, // "testnet" or "mainnet" string (v7.x)
    memo,
  };

  // Only set fee if explicitly provided; otherwise let the builder auto-estimate
  if (fee !== undefined) {
    txOptions.fee = BigInt(fee);
  }

  const transaction = await makeSTXTokenTransfer(txOptions);
  return transaction;
}

/**
 * Broadcasts a signed transaction to the Stacks network.
 *
 * @param {import("@stacks/transactions").StacksTransaction} transaction
 * @returns {Promise<{ txid: string }>}
 *
 * The returned txid can be viewed on Stacks Explorer:
 *   Testnet: https://explorer.hiro.so/txid/{txid}?chain=testnet
 *   Mainnet: https://explorer.hiro.so/txid/{txid}?chain=mainnet
 */
export async function broadcast(transaction) {
  // v7.x syntax: broadcastTransaction({ transaction, network })
  // Also supports legacy: broadcastTransaction(transaction)
  const response = await broadcastTransaction({
    transaction,
    network: config.stacksNetwork,
  });
  return response;
}

/**
 * Convenience: Create, sign, and broadcast an STX transfer in one call.
 *
 * @param {Object} params - Same as createSTXTransfer
 * @returns {Promise<{ txid: string, explorerUrl: string }>}
 */
export async function sendSTX(params) {
  const transaction = await createSTXTransfer(params);
  const result = await broadcast(transaction);

  const chain = config.stacksNetwork === "mainnet" ? "mainnet" : "testnet";
  const explorerUrl = `https://explorer.hiro.so/txid/${result.txid}?chain=${chain}`;

  return {
    txid: result.txid,
    explorerUrl,
  };
}

// ---------------------------------------------------------------------------
// sBTC (SIP-010) Token Transfers
// ---------------------------------------------------------------------------

/**
 * Creates a signed sBTC (SIP-010) token transfer transaction.
 *
 * sBTC is a SIP-010 fungible token on Stacks. Transfers are done via
 * contract-call to the `transfer` function:
 *   (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
 *
 * @param {Object} params
 * @param {string} params.recipientAddress - Stacks address to send sBTC to
 * @param {bigint|number|string} params.amount - Amount in satoshis (1 sBTC = 100,000,000 sats)
 * @param {string} params.senderKey - Sender's private key (hex string)
 * @param {string} params.senderAddress - Sender's Stacks address
 * @param {string} [params.memo] - Optional memo (max 34 bytes)
 * @returns {Promise<import("@stacks/transactions").StacksTransaction>}
 */
export async function createSBTCTransfer({
  recipientAddress,
  amount,
  senderKey,
  senderAddress,
  memo = "",
}) {
  const [contractAddress, contractName] = config.sbtcContract.split(".");

  // Build function arguments for SIP-010 transfer
  const functionArgs = [
    uintCV(BigInt(amount)),
    standardPrincipalCV(senderAddress),
    standardPrincipalCV(recipientAddress),
    memo ? someCV(bufferCV(Buffer.from(memo.slice(0, 34)))) : noneCV(),
  ];

  // Post-condition: sender must send exactly this amount of sBTC
  const postConditions = [
    makeStandardFungiblePostCondition(
      senderAddress,
      FungibleConditionCode.Equal,
      BigInt(amount),
      `${contractAddress}.${contractName}::sbtc`
    ),
  ];

  const txOptions = {
    contractAddress,
    contractName,
    functionName: "transfer",
    functionArgs,
    senderKey,
    network: config.stacksNetwork,
    postConditions,
    postConditionMode: PostConditionMode.Deny,
  };

  const transaction = await makeContractCall(txOptions);
  return transaction;
}

/**
 * Convenience: Create, sign, and broadcast an sBTC transfer in one call.
 *
 * @param {Object} params - Same as createSBTCTransfer
 * @returns {Promise<{ txid: string, explorerUrl: string }>}
 */
export async function sendSBTC(params) {
  const transaction = await createSBTCTransfer(params);
  const result = await broadcast(transaction);

  const chain = config.stacksNetwork === "mainnet" ? "mainnet" : "testnet";
  const explorerUrl = `https://explorer.hiro.so/txid/${result.txid}?chain=${chain}`;

  return {
    txid: result.txid,
    explorerUrl,
  };
}

/**
 * Extracts payment details from a deserialized sBTC contract-call transaction.
 *
 * @param {import("@stacks/transactions").StacksTransaction} tx
 * @returns {{ recipientAddress: string, amount: bigint, memo: string, asset: string } | null}
 */
export function extractSBTCPaymentDetails(tx) {
  try {
    const payload = tx.payload;

    // Contract-call payloads have:
    // payload.contractAddress, payload.contractName, payload.functionName, payload.functionArgs

    if (payload.functionName !== "transfer") {
      return null;
    }

    const args = payload.functionArgs;
    if (!args || args.length < 3) {
      return null;
    }

    // args[0] = amount (uint), args[1] = sender, args[2] = recipient, args[3] = memo (optional)
    const amount = args[0].value ? BigInt(args[0].value) : 0n;

    let recipientAddress = "";
    if (args[2] && args[2].address) {
      const addr = args[2].address;
      if (typeof addr === "string") {
        recipientAddress = addr;
      } else if (addr.hash160) {
        recipientAddress = `[hash160:${addr.hash160}]`;
      }
    }

    let memo = "";
    if (args[3] && args[3].value && args[3].value.buffer) {
      memo = args[3].value.buffer.toString("utf8").replace(/\0/g, "").trim();
    }

    return {
      recipientAddress,
      amount,
      memo,
      asset: "sBTC",
    };
  } catch (err) {
    console.error("Failed to extract sBTC payment details:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transaction deserialization & verification
// ---------------------------------------------------------------------------

/**
 * Deserializes a Stacks transaction from its hex-encoded string.
 *
 * This is used by the server to inspect a signed transaction that a client
 * sent in the payment-signature header WITHOUT broadcasting it yet.
 *
 * The returned StacksTransaction object has a `payload` property with:
 *   - payload.recipient (ClarityValue — the recipient address)
 *   - payload.amount (bigint — microSTX)
 *   - payload.memo (object — the memo content)
 *
 * @param {string} txHex - Hex-encoded serialized transaction
 * @returns {import("@stacks/transactions").StacksTransaction}
 *
 * Note: In @stacks/transactions v7.x, deserializeTransaction accepts a hex string directly.
 * In older versions (v6 and below), it required a BytesReader.
 */
export function deserializeTx(txHex) {
  return deserializeTransaction(txHex);
}

/**
 * Extracts human-readable payment details from a deserialized transaction.
 * @param {import("@stacks/transactions").StacksTransaction} tx
 * @returns {{ recipientAddress: string, amount: bigint, memo: string } | null}
 */
export function extractPaymentDetails(tx) {
  try {
    const payload = tx.payload;

    // STX token transfer payloads have these fields in v7.x:
    // payload.recipient — a ClarityValue (StandardPrincipalCV or ContractPrincipalCV)
    // payload.amount — bigint
    // payload.memo — { type, content }
    //
    // The recipient is a ClarityValue that needs to be converted to a string address.
    // We try multiple approaches since the internal API may vary.

    let recipientAddress = "";
    if (payload.recipient) {
      if (typeof payload.recipient === "string") {
        recipientAddress = payload.recipient;
      } else if (payload.recipient.address) {
        // StandardPrincipalCV has .address property in some versions
        const addr = payload.recipient.address;
        if (typeof addr === "string") {
          recipientAddress = addr;
        } else if (addr.hash160) {
          // Might need to reconstruct from hash — fallback
          recipientAddress = `[hash160:${addr.hash160}]`;
        }
      } else if (payload.recipient.value) {
        recipientAddress = payload.recipient.value;
      }
    }

    const amount = payload.amount ? BigInt(payload.amount) : 0n;

    let memo = "";
    if (payload.memo) {
      if (typeof payload.memo === "string") {
        memo = payload.memo;
      } else if (payload.memo.content) {
        // Memo content is a buffer/string
        memo =
          typeof payload.memo.content === "string"
            ? payload.memo.content.replace(/\0/g, "").trim()
            : "";
      }
    }

    return { recipientAddress, amount, memo };
  } catch (err) {
    console.error("Failed to extract payment details:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hiro API lookups
// ---------------------------------------------------------------------------

/**
 * Fetches transaction details from the Hiro Stacks API.
 *
 * Endpoint: GET /extended/v1/tx/{txid}
 *
 * @param {string} txid - Transaction ID (with or without 0x prefix)
 * @returns {Promise<Object>} - Full transaction object from API
 *
 * Response includes:
 *   tx_id, tx_type ("token_transfer"), tx_status ("success"|"pending"|"failed"),
 *   sender_address, token_transfer: { recipient_address, amount, memo }
 */
export async function getTransactionStatus(txid) {
  const url = `${config.stacksApiUrl}/extended/v1/tx/${txid}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Hiro API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * Fetches STX balance for an address.
 *
 * Endpoint: GET /extended/v1/address/{addr}/stx
 *
 * @param {string} address - Stacks address (ST... for testnet, SP... for mainnet)
 * @returns {Promise<{ balance: string, total_sent: string, total_received: string }>}
 */
export async function getSTXBalance(address) {
  const url = `${config.stacksApiUrl}/extended/v1/address/${address}/stx`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Hiro API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * Requests testnet STX from the faucet.
 *
 * Endpoint: POST /extended/v1/faucets/stx?address={addr}&stacking=false
 *
 * Only works on testnet. Gives 500 STX per request.
 * Rate limited. Tokens arrive after inclusion in an anchor block.
 *
 * @param {string} address - Testnet address (must start with "ST")
 * @returns {Promise<{ success: boolean, txId: string, txRaw: string }>}
 */
export async function requestTestnetSTX(address) {
  if (!address.startsWith("ST")) {
    throw new Error(
      `Faucet only works with testnet addresses (starting with ST). Got: ${address}`
    );
  }

  const url = `${config.stacksApiUrl}/extended/v1/faucets/stx?address=${address}&stacking=false`;
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Faucet error: ${response.status} — ${body}`);
  }
  return response.json();
}
