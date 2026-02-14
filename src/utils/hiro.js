/**
 * hiro.js — Hiro Stacks API client for fetching REAL on-chain data.
 *
 * All endpoints are free, no API key required (testnet or mainnet).
 * Base URLs:
 *   Testnet: https://api.testnet.hiro.so
 *   Mainnet: https://api.hiro.so
 *
 * Verified endpoints (Feb 2025):
 *   GET  /extended/v1/address/{addr}/stx          — STX balance
 *   GET  /extended/v1/address/{addr}/transactions  — Transaction history
 *   GET  /extended/v1/tx/{txid}                    — Transaction details
 *   GET  /extended/v1/tx/mempool                   — Mempool transactions
 *   GET  /extended/v2/blocks                       — Recent blocks
 *   GET  /v2/info                                  — Node/chain info
 *   GET  /extended/v1/address/{addr}/nonces        — Account nonces
 *   GET  /extended/v1/address/{addr}/balances      — Full balances (STX + FT + NFT)
 */

import config from "../config.js";
import log from "./logger.js";

const BASE = config.stacksApiUrl;

/**
 * Generic fetch wrapper with error handling and timeout.
 */
async function hiroGet(path) {
  const url = `${BASE}${path}`;
  log.info("Hiro", `GET ${path}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Hiro API ${res.status}: ${res.statusText} for ${path}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error(`Hiro API timeout after 15s for ${path}`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Account / Address endpoints
// ---------------------------------------------------------------------------

/**
 * Get STX balance for an address.
 * Returns { balance, total_sent, total_received, total_fees_sent,
 *           total_miner_rewards_received, lock_tx_id, locked,
 *           lock_height, burnchain_lock_height, burnchain_unlock_height }
 */
export async function getSTXBalance(address) {
  return hiroGet(`/extended/v1/address/${address}/stx`);
}

/**
 * Get full balances (STX + fungible tokens + NFTs) for an address.
 * Returns { stx: {...}, fungible_tokens: {...}, non_fungible_tokens: {...} }
 */
export async function getFullBalances(address) {
  return hiroGet(`/extended/v1/address/${address}/balances`);
}

/**
 * Get recent transactions for an address.
 * Returns { limit, offset, total, results: [...transactions] }
 */
export async function getAddressTransactions(address, limit = 20) {
  return hiroGet(
    `/extended/v1/address/${address}/transactions?limit=${limit}`
  );
}

/**
 * Get account nonces (confirmed + pending).
 * Returns { last_mempool_tx_nonce, last_executed_tx_nonce,
 *           possible_next_nonce, detected_missing_nonces }
 */
export async function getAccountNonces(address) {
  return hiroGet(`/extended/v1/address/${address}/nonces`);
}

// ---------------------------------------------------------------------------
// Transaction endpoints
// ---------------------------------------------------------------------------

/**
 * Get a specific transaction by txid.
 * Returns full transaction object with tx_status, sender_address,
 * token_transfer details, etc.
 */
export async function getTransaction(txid) {
  return hiroGet(`/extended/v1/tx/${txid}`);
}

/**
 * Get recent mempool transactions.
 */
export async function getMempoolTransactions(limit = 20) {
  return hiroGet(`/extended/v1/tx/mempool?limit=${limit}`);
}

/**
 * Get recent confirmed transactions.
 */
export async function getRecentTransactions(limit = 20) {
  return hiroGet(`/extended/v1/tx?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Block endpoints
// ---------------------------------------------------------------------------

/**
 * Get recent blocks.
 * Returns { limit, offset, total, results: [...blocks] }
 */
export async function getRecentBlocks(limit = 5) {
  return hiroGet(`/extended/v2/blocks?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Chain info
// ---------------------------------------------------------------------------

/**
 * Get current chain info (tip height, burn block, etc).
 * Returns { peer_version, pox_consensus, burn_block_height,
 *           stable_pox_consensus, stable_burn_block_height,
 *           server_version, network_id, parent_network_id,
 *           stacks_tip_height, stacks_tip, stacks_tip_consensus_hash, ... }
 */
export async function getChainInfo() {
  return hiroGet(`/v2/info`);
}

// ---------------------------------------------------------------------------
// Composite analysis functions (used by skills)
// ---------------------------------------------------------------------------

/**
 * Full wallet audit: balance + recent transactions + risk scoring.
 * This is the REAL on-chain data that makes the wallet-auditor skill valuable.
 *
 * @param {string} address - Stacks address to audit
 * @returns {Object} Comprehensive wallet analysis
 */
export async function auditWallet(address) {
  // Fetch balance + transactions in parallel
  const [balanceData, txData, nonceData] = await Promise.all([
    getFullBalances(address),
    getAddressTransactions(address, 50),
    getAccountNonces(address),
  ]);

  // Parse STX balance
  const stxBalance = balanceData.stx || {};
  const balanceMicroSTX = BigInt(stxBalance.balance || "0");
  const lockedMicroSTX = BigInt(stxBalance.locked || "0");
  const availableMicroSTX = balanceMicroSTX - lockedMicroSTX;

  // Count fungible tokens
  const ftTokens = Object.keys(balanceData.fungible_tokens || {});
  const nftTokens = Object.keys(balanceData.non_fungible_tokens || {});

  // Analyze transactions
  const transactions = txData.results || [];
  const totalTxCount = txData.total || 0;

  let sentCount = 0;
  let receivedCount = 0;
  let contractCallCount = 0;
  let totalSentMicroSTX = 0n;
  let totalReceivedMicroSTX = 0n;
  const uniqueInteractions = new Set();
  const recentTxSummaries = [];

  for (const tx of transactions.slice(0, 50)) {
    // Track interaction partners
    if (tx.sender_address && tx.sender_address !== address) {
      uniqueInteractions.add(tx.sender_address);
    }
    if (tx.token_transfer?.recipient_address) {
      uniqueInteractions.add(tx.token_transfer.recipient_address);
    }

    // Categorize transactions
    if (tx.tx_type === "token_transfer") {
      if (tx.sender_address === address) {
        sentCount++;
        totalSentMicroSTX += BigInt(tx.token_transfer?.amount || "0");
      } else {
        receivedCount++;
        totalReceivedMicroSTX += BigInt(tx.token_transfer?.amount || "0");
      }
    } else if (tx.tx_type === "contract_call") {
      contractCallCount++;
    }

    // Build recent tx summaries (top 10)
    if (recentTxSummaries.length < 10) {
      recentTxSummaries.push({
        txid: tx.tx_id,
        type: tx.tx_type,
        status: tx.tx_status,
        sender: tx.sender_address,
        blockHeight: tx.block_height,
        blockTime: tx.block_time_iso,
        fee: tx.fee_rate,
        ...(tx.token_transfer
          ? {
              recipient: tx.token_transfer.recipient_address,
              amount: tx.token_transfer.amount,
              memo: tx.token_transfer.memo,
            }
          : {}),
        ...(tx.contract_call
          ? {
              contractId: tx.contract_call.contract_id,
              functionName: tx.contract_call.function_name,
            }
          : {}),
      });
    }
  }

  // Risk scoring
  let riskScore = 0;
  const riskFactors = [];

  // Low activity risk
  if (totalTxCount < 5) {
    riskScore += 20;
    riskFactors.push("Very low transaction history (< 5 total)");
  }

  // One-way flow risk
  if (sentCount > 0 && receivedCount === 0) {
    riskScore += 15;
    riskFactors.push("Only outbound transactions — possible drain pattern");
  }
  if (receivedCount > 0 && sentCount === 0) {
    riskScore += 10;
    riskFactors.push("Only inbound transactions — accumulation only");
  }

  // Large balance with no stacking
  if (availableMicroSTX > 100_000_000_000n && lockedMicroSTX === 0n) {
    riskScore += 10;
    riskFactors.push("Large balance (>100K STX) not stacking — missing yield");
  }

  // No contract interactions
  if (contractCallCount === 0 && totalTxCount > 10) {
    riskScore += 5;
    riskFactors.push("No DeFi or contract interactions despite activity");
  }

  // Nonce gap detection
  if (
    nonceData.detected_missing_nonces &&
    nonceData.detected_missing_nonces.length > 0
  ) {
    riskScore += 15;
    riskFactors.push(
      `Missing nonces detected: [${nonceData.detected_missing_nonces.join(", ")}]`
    );
  }

  // Normalize risk score to 0-100
  riskScore = Math.min(riskScore, 100);

  const riskLevel =
    riskScore < 20 ? "low" : riskScore < 50 ? "medium" : "high";

  return {
    address,
    network: config.stacksNetwork,
    balance: {
      totalMicroSTX: balanceMicroSTX.toString(),
      totalSTX: (Number(balanceMicroSTX) / 1_000_000).toFixed(6),
      lockedMicroSTX: lockedMicroSTX.toString(),
      lockedSTX: (Number(lockedMicroSTX) / 1_000_000).toFixed(6),
      availableMicroSTX: availableMicroSTX.toString(),
      availableSTX: (Number(availableMicroSTX) / 1_000_000).toFixed(6),
      isStacking: lockedMicroSTX > 0n,
    },
    tokens: {
      fungibleTokenCount: ftTokens.length,
      fungibleTokens: ftTokens.slice(0, 20), // cap at 20
      nftCount: nftTokens.length,
      nftCollections: nftTokens.slice(0, 20),
    },
    activity: {
      totalTransactions: totalTxCount,
      recentAnalyzed: transactions.length,
      sent: sentCount,
      received: receivedCount,
      contractCalls: contractCallCount,
      totalSentSTX: (Number(totalSentMicroSTX) / 1_000_000).toFixed(6),
      totalReceivedSTX: (Number(totalReceivedMicroSTX) / 1_000_000).toFixed(6),
      uniqueAddressesInteracted: uniqueInteractions.size,
    },
    risk: {
      score: riskScore,
      level: riskLevel,
      factors: riskFactors,
    },
    nonce: {
      lastExecuted: nonceData.last_executed_tx_nonce,
      possibleNext: nonceData.possible_next_nonce,
      missingNonces: nonceData.detected_missing_nonces || [],
    },
    recentTransactions: recentTxSummaries,
    explorerUrl: `https://explorer.hiro.so/address/${address}?chain=${config.stacksNetwork}`,
    auditedAt: new Date().toISOString(),
  };
}

/**
 * Alpha signals: whale movements, trending contracts, large pending txs.
 * Premium intelligence feed for agents who want an edge.
 *
 * @returns {Object} Alpha signals from live chain data
 */
export async function getAlphaSignals() {
  const [recentTxs, mempool] = await Promise.all([
    getRecentTransactions(50),
    getMempoolTransactions(30),
  ]);

  // Detect whale movements (transfers > 10,000 STX)
  const whaleMovements = (recentTxs.results || [])
    .filter(
      (tx) =>
        tx.tx_type === "token_transfer" &&
        BigInt(tx.token_transfer?.amount || 0) > 10_000_000_000n
    )
    .map((tx) => ({
      txid: tx.tx_id,
      sender: tx.sender_address,
      recipient: tx.token_transfer.recipient_address,
      amountMicroSTX: tx.token_transfer.amount,
      amountSTX: (Number(tx.token_transfer.amount) / 1_000_000).toFixed(2),
      blockHeight: tx.block_height,
      blockTime: tx.block_time_iso,
    }));

  // Find trending contracts (most called in recent blocks)
  const contractCalls = {};
  for (const tx of recentTxs.results || []) {
    if (tx.contract_call) {
      const id = tx.contract_call.contract_id;
      contractCalls[id] = (contractCalls[id] || 0) + 1;
    }
  }
  const trendingContracts = Object.entries(contractCalls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([contractId, callCount]) => ({ contractId, callCount }));

  // Large pending transactions (high fee rate indicates urgency)
  const largePending = (mempool.results || [])
    .filter((tx) => BigInt(tx.fee_rate || 0) > 100_000n)
    .map((tx) => ({
      txid: tx.tx_id,
      type: tx.tx_type,
      sender: tx.sender_address,
      feeRate: tx.fee_rate,
      receiptTime: tx.receipt_time_iso,
      ...(tx.token_transfer
        ? {
            recipient: tx.token_transfer.recipient_address,
            amountSTX: (
              Number(tx.token_transfer.amount) / 1_000_000
            ).toFixed(2),
          }
        : {}),
      ...(tx.contract_call
        ? {
            contractId: tx.contract_call.contract_id,
            functionName: tx.contract_call.function_name,
          }
        : {}),
    }));

  return {
    whaleMovements,
    trendingContracts,
    largePending,
    summary: {
      whaleCount: whaleMovements.length,
      trendingCount: trendingContracts.length,
      largePendingCount: largePending.length,
    },
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Chain activity snapshot: blocks, mempool, and network stats.
 * This is the REAL on-chain data for the alpha-signal skill.
 */
// ---------------------------------------------------------------------------
// SIP-010 Token helpers (used by treasury.js)
// ---------------------------------------------------------------------------

/**
 * Get specific SIP-010 token balance by contract identifier.
 * @param {string} address - Stacks address to query
 * @param {string} tokenContract - Contract identifier (e.g., "SP4SZE...::ststxbtc-token")
 * @returns {Promise<string>} Balance as string (raw units)
 */
export async function getTokenBalance(address, tokenContract) {
  const balances = await getFullBalances(address);
  const ftTokens = balances.fungible_tokens || {};

  const tokenKey = Object.keys(ftTokens).find((key) =>
    key.startsWith(tokenContract)
  );

  return tokenKey ? ftTokens[tokenKey].balance : "0";
}

/**
 * Check if address has any StackingDAO positions (stSTX or stSTXbtc).
 * @param {string} address - Stacks address to query
 * @returns {Promise<boolean>} True if address has StackingDAO positions
 */
export async function hasStackingDAOPosition(address) {
  const balances = await getFullBalances(address);
  const ftTokens = balances.fungible_tokens || {};

  return Object.keys(ftTokens).some(
    (key) => key.includes("ststx") || key.includes("stacking-dao")
  );
}

// ---------------------------------------------------------------------------
// Composite analysis functions (used by skills)
// ---------------------------------------------------------------------------

export async function getChainSnapshot() {
  const [chainInfo, blocks, mempool, recentTxs] = await Promise.all([
    getChainInfo(),
    getRecentBlocks(10),
    getMempoolTransactions(30),
    getRecentTransactions(30),
  ]);

  // Analyze block times
  const blockResults = blocks.results || [];
  const blockTimes = [];
  for (let i = 0; i < blockResults.length - 1; i++) {
    const diff = blockResults[i].burn_block_time - blockResults[i + 1].burn_block_time;
    blockTimes.push(diff);
  }
  const avgBlockTime =
    blockTimes.length > 0
      ? blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length
      : 0;

  // Analyze mempool
  const mempoolTxs = mempool.results || [];
  const mempoolTypes = {};
  let mempoolTotalFees = 0n;
  for (const tx of mempoolTxs) {
    mempoolTypes[tx.tx_type] = (mempoolTypes[tx.tx_type] || 0) + 1;
    mempoolTotalFees += BigInt(tx.fee_rate || "0");
  }

  // Analyze recent confirmed transactions for patterns
  const confirmedTxs = recentTxs.results || [];
  const txTypes = {};
  let totalVolumeMicroSTX = 0n;
  const activeContracts = new Set();

  for (const tx of confirmedTxs) {
    txTypes[tx.tx_type] = (txTypes[tx.tx_type] || 0) + 1;
    if (tx.tx_type === "token_transfer" && tx.token_transfer) {
      totalVolumeMicroSTX += BigInt(tx.token_transfer.amount || "0");
    }
    if (tx.tx_type === "contract_call" && tx.contract_call) {
      activeContracts.add(tx.contract_call.contract_id);
    }
  }

  return {
    network: config.stacksNetwork,
    chainTip: {
      stacksTipHeight: chainInfo.stacks_tip_height,
      stacksTip: chainInfo.stacks_tip,
      burnBlockHeight: chainInfo.burn_block_height,
      serverVersion: chainInfo.server_version,
      networkId: chainInfo.network_id,
    },
    blocks: {
      recentCount: blockResults.length,
      averageBlockTimeSeconds: Math.round(avgBlockTime),
      latestBlock: blockResults[0]
        ? {
            height: blockResults[0].height,
            hash: blockResults[0].hash,
            time: blockResults[0].burn_block_time_iso,
            txCount: blockResults[0].tx_count,
          }
        : null,
    },
    mempool: {
      pendingCount: mempoolTxs.length,
      typeBreakdown: mempoolTypes,
      totalPendingFeesMicroSTX: mempoolTotalFees.toString(),
    },
    recentActivity: {
      confirmedTxCount: confirmedTxs.length,
      typeBreakdown: txTypes,
      totalVolumeSTX: (Number(totalVolumeMicroSTX) / 1_000_000).toFixed(6),
      activeContracts: [...activeContracts].slice(0, 15),
    },
    snapshotAt: new Date().toISOString(),
  };
}
