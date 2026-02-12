/**
 * skills.js — Skill registry for MoltMarket.
 *
 * UPGRADED: Skills now fetch REAL on-chain data from the Stacks blockchain
 * via the Hiro API. No mock data — every skill output contains live
 * blockchain information that changes with every request.
 */

import config from "../config.js";
import { auditWallet, getChainSnapshot, getAlphaSignals } from "../utils/hiro.js";
import log from "../utils/logger.js";

/**
 * The skill catalog. Each skill's execute() is ASYNC because
 * it fetches real data from the blockchain.
 */
const SKILLS = [
  {
    id: "wallet-auditor",
    name: "Stacks Wallet Auditor",
    description:
      "Performs a comprehensive on-chain audit of any Stacks address. " +
      "Returns REAL balance data (STX + tokens + NFTs), transaction history analysis, " +
      "stacking status, risk scoring, and activity patterns. " +
      "All data fetched live from the Hiro Stacks API — not simulated. " +
      "An agent-to-agent intelligence service: one Moltbot pays to audit another's wallet.",
    category: "bitcoin-intelligence",
    price: "5000", // 5000 microSTX = 0.005 STX
    asset: "STX",
    preview:
      "Free preview: This skill audits any Stacks address with real on-chain data. " +
      "Includes balance, token holdings, transaction patterns, stacking status, and risk score. " +
      "Pay to run the full audit.",
    providers: [
      {
        name: "chain-data-provider",
        addressKey: "a",
        sharePercent: 70,
      },
      {
        name: "risk-analysis-provider",
        addressKey: "b",
        sharePercent: 30,
      },
    ],
    execute: async (input) => {
      const address = input?.address || input?.walletAddress || input?.target;

      if (!address) {
        return {
          error: "Missing required input: 'address' (a Stacks address to audit)",
          example: { address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM" },
        };
      }

      // Validate address format
      const prefix = config.stacksNetwork === "mainnet" ? "SP" : "ST";
      if (!address.startsWith(prefix)) {
        return {
          error: `Address must start with '${prefix}' for ${config.stacksNetwork}. Got: ${address}`,
        };
      }

      log.info("Skill:wallet-auditor", `Auditing address: ${address}`);

      try {
        const audit = await auditWallet(address);
        return {
          skill: "wallet-auditor",
          dataSource: "Hiro Stacks API (live on-chain data)",
          audit,
          paidVia: "x402-stacks",
        };
      } catch (err) {
        log.error("Skill:wallet-auditor", `Audit failed: ${err.message}`);
        return {
          skill: "wallet-auditor",
          error: `Failed to audit address: ${err.message}`,
          address,
          suggestion: "Verify the address exists and has on-chain activity.",
        };
      }
    },
  },
  {
    id: "stacks-intel",
    name: "Stacks Chain Intelligence",
    description:
      "Live Stacks blockchain analytics: current chain tip, block production rate, " +
      "mempool analysis, transaction volume, active smart contracts, and network health. " +
      "All data fetched in real-time from the Hiro API. " +
      "The premium signal feed for agents operating in the Stacks ecosystem.",
    category: "bitcoin-intelligence",
    price: "3000", // 3000 microSTX = 0.003 STX
    asset: "STX",
    preview:
      "Free preview: Stacks tip height and latest block available. " +
      "Pay for full chain intelligence including mempool analysis, volume trends, " +
      "active contracts, and block timing analysis.",
    providers: [
      {
        name: "block-data-provider",
        addressKey: "b",
        sharePercent: 60,
      },
      {
        name: "analytics-provider",
        addressKey: "c",
        sharePercent: 40,
      },
    ],
    execute: async (input) => {
      log.info("Skill:stacks-intel", "Fetching live chain intelligence...");

      try {
        const snapshot = await getChainSnapshot();

        // Generate intelligence insights from the live data
        const insights = [];

        // Block timing insight
        if (snapshot.blocks.averageBlockTimeSeconds > 0) {
          const avgTime = snapshot.blocks.averageBlockTimeSeconds;
          if (avgTime <= 10) {
            insights.push({
              type: "network-health",
              signal: "healthy",
              title: "Block production on track",
              detail: `Average block time: ${avgTime}s (post-Nakamoto target: ~5s). Network is performing well.`,
            });
          } else if (avgTime <= 60) {
            insights.push({
              type: "network-health",
              signal: "caution",
              title: "Slightly slow block production",
              detail: `Average block time: ${avgTime}s. Slight delay but within normal variance.`,
            });
          } else {
            insights.push({
              type: "network-health",
              signal: "warning",
              title: "Block production delayed",
              detail: `Average block time: ${avgTime}s. Significantly above target. Monitor for network issues.`,
            });
          }
        }

        // Mempool insight
        if (snapshot.mempool.pendingCount > 0) {
          insights.push({
            type: "mempool",
            signal: snapshot.mempool.pendingCount > 50 ? "congested" : "normal",
            title: `Mempool: ${snapshot.mempool.pendingCount} pending transactions`,
            detail: `Type breakdown: ${JSON.stringify(snapshot.mempool.typeBreakdown)}. ` +
              `Total pending fees: ${(Number(snapshot.mempool.totalPendingFeesMicroSTX) / 1_000_000).toFixed(6)} STX.`,
          });
        }

        // Contract activity insight
        if (snapshot.recentActivity.activeContracts.length > 0) {
          insights.push({
            type: "defi-activity",
            signal: "active",
            title: `${snapshot.recentActivity.activeContracts.length} active smart contracts`,
            detail: `Most active contracts: ${snapshot.recentActivity.activeContracts.slice(0, 5).join(", ")}`,
          });
        }

        // Volume insight
        const volumeSTX = parseFloat(snapshot.recentActivity.totalVolumeSTX);
        if (volumeSTX > 0) {
          insights.push({
            type: "volume",
            signal: volumeSTX > 10000 ? "high" : volumeSTX > 100 ? "moderate" : "low",
            title: `Recent STX transfer volume: ${snapshot.recentActivity.totalVolumeSTX} STX`,
            detail: `Across ${snapshot.recentActivity.confirmedTxCount} recent confirmed transactions.`,
          });
        }

        return {
          skill: "stacks-intel",
          dataSource: "Hiro Stacks API (live on-chain data)",
          snapshot,
          insights,
          paidVia: "x402-stacks",
        };
      } catch (err) {
        log.error("Skill:stacks-intel", `Intel failed: ${err.message}`);
        return {
          skill: "stacks-intel",
          error: `Failed to fetch chain intelligence: ${err.message}`,
        };
      }
    },
  },
  {
    id: "alpha-leak",
    name: "Alpha Signal Feed",
    description:
      "Private intelligence feed: whale movements (>10K STX transfers), " +
      "trending smart contracts, high-fee pending transactions. " +
      "Real-time alpha from the Stacks mempool and recent blocks. " +
      "The premium edge for agents operating in the Stacks ecosystem. " +
      "Pay in STX or sBTC (Bitcoin on Stacks).",
    category: "bitcoin-intelligence",
    price: "10000", // 10000 microSTX = 0.01 STX (premium)
    asset: "STX",
    // Multi-asset pricing: agents can pay in STX or sBTC
    acceptedAssets: [
      { asset: "STX", amount: "10000", display: "0.01 STX" },
      { asset: "sBTC", amount: "1000", display: "1,000 sats" }, // ~0.00001 BTC
    ],
    preview:
      "Free preview: Alpha signals detected. Pay in STX or sBTC to reveal " +
      "whale addresses, contract IDs, and transaction details.",
    providers: [
      {
        name: "signal-detector",
        addressKey: "a",
        sharePercent: 60,
      },
      {
        name: "alpha-analyst",
        addressKey: "c",
        sharePercent: 40,
      },
    ],
    execute: async (input) => {
      log.info("Skill:alpha-leak", "Scanning for alpha signals...");

      try {
        const signals = await getAlphaSignals();

        // Generate insights from the signals
        const insights = [];

        if (signals.whaleMovements.length > 0) {
          const totalWhaleVolume = signals.whaleMovements.reduce(
            (sum, w) => sum + parseFloat(w.amountSTX),
            0
          );
          insights.push({
            type: "whale-alert",
            signal: "active",
            title: `${signals.whaleMovements.length} whale movements detected`,
            detail: `Total volume: ${totalWhaleVolume.toFixed(2)} STX in large transfers (>10K STX each).`,
          });
        }

        if (signals.trendingContracts.length > 0) {
          insights.push({
            type: "trending-contracts",
            signal: "active",
            title: `${signals.trendingContracts.length} trending smart contracts`,
            detail: `Top contract: ${signals.trendingContracts[0].contractId} (${signals.trendingContracts[0].callCount} calls).`,
          });
        }

        if (signals.largePending.length > 0) {
          insights.push({
            type: "mempool-priority",
            signal: "active",
            title: `${signals.largePending.length} high-priority pending transactions`,
            detail: `High-fee transactions waiting in mempool — potential arbitrage or urgent transfers.`,
          });
        }

        if (insights.length === 0) {
          insights.push({
            type: "quiet-market",
            signal: "neutral",
            title: "No significant alpha detected",
            detail: "Market is quiet. No whale movements, trending contracts, or urgent transactions.",
          });
        }

        return {
          skill: "alpha-leak",
          dataSource: "Hiro Stacks API (live)",
          signals,
          insights,
          paidVia: "x402-stacks",
        };
      } catch (err) {
        log.error("Skill:alpha-leak", `Alpha scan failed: ${err.message}`);
        return {
          skill: "alpha-leak",
          error: `Failed to scan for alpha signals: ${err.message}`,
        };
      }
    },
  },
  {
    id: "bounty-executor",
    name: "Moltbot Bounty Executor",
    description:
      "The orchestration skill: post a task, and this agent executes it by combining " +
      "multiple on-chain data sources. Supports tasks like: " +
      "'Compare two wallets', 'Find the most active address in recent blocks', " +
      "'Check if address X is stacking'. " +
      "Implements Tony's vision: x402-funded bot bounties where agents hire agents. " +
      "Pay in STX or sBTC (Bitcoin on Stacks).",
    category: "bounty-orchestration",
    price: "8000", // 8000 microSTX = 0.008 STX
    asset: "STX",
    // Multi-asset pricing: agents can pay in STX or sBTC
    acceptedAssets: [
      { asset: "STX", amount: "8000", display: "0.008 STX" },
      { asset: "sBTC", amount: "800", display: "800 sats" }, // ~0.000008 BTC
    ],
    preview:
      "Free preview: Submit any on-chain query as a bounty. Pay in STX or sBTC. " +
      "This skill orchestrates multiple Hiro API calls to fulfill your request. " +
      "Supported: wallet comparison, activity analysis, stacking checks.",
    providers: [
      {
        name: "orchestrator-provider",
        addressKey: "a",
        sharePercent: 50,
      },
      {
        name: "data-provider",
        addressKey: "c",
        sharePercent: 50,
      },
    ],
    execute: async (input) => {
      const task = input?.task || input?.bounty || input?.query;
      const addresses = input?.addresses || [];
      const address = input?.address || addresses[0];

      if (!task) {
        return {
          error: "Missing required input: 'task' (describe what you need)",
          examples: [
            {
              task: "compare-wallets",
              addresses: ["ST1ADDR1...", "ST2ADDR2..."],
            },
            {
              task: "wallet-activity",
              address: "ST1ADDR...",
            },
            {
              task: "chain-overview",
            },
          ],
        };
      }

      log.info("Skill:bounty-executor", `Executing bounty: ${task}`);

      try {
        const taskLower = task.toLowerCase();

        if (taskLower.includes("compare") && addresses.length >= 2) {
          // COMPARE TWO WALLETS
          const [audit1, audit2] = await Promise.all([
            auditWallet(addresses[0]),
            auditWallet(addresses[1]),
          ]);

          const comparison = {
            addresses: [addresses[0], addresses[1]],
            balanceComparison: {
              [addresses[0]]: audit1.balance.availableSTX + " STX",
              [addresses[1]]: audit2.balance.availableSTX + " STX",
              higherBalance:
                BigInt(audit1.balance.availableMicroSTX) >
                BigInt(audit2.balance.availableMicroSTX)
                  ? addresses[0]
                  : addresses[1],
            },
            activityComparison: {
              [addresses[0]]: {
                totalTx: audit1.activity.totalTransactions,
                uniqueContacts: audit1.activity.uniqueAddressesInteracted,
              },
              [addresses[1]]: {
                totalTx: audit2.activity.totalTransactions,
                uniqueContacts: audit2.activity.uniqueAddressesInteracted,
              },
              moreActive:
                audit1.activity.totalTransactions >
                audit2.activity.totalTransactions
                  ? addresses[0]
                  : addresses[1],
            },
            riskComparison: {
              [addresses[0]]: { score: audit1.risk.score, level: audit1.risk.level },
              [addresses[1]]: { score: audit2.risk.score, level: audit2.risk.level },
              lowerRisk:
                audit1.risk.score < audit2.risk.score
                  ? addresses[0]
                  : addresses[1],
            },
          };

          return {
            skill: "bounty-executor",
            task: "compare-wallets",
            dataSource: "Hiro Stacks API (live on-chain data)",
            result: comparison,
            fullAudits: { [addresses[0]]: audit1, [addresses[1]]: audit2 },
            paidVia: "x402-stacks",
          };
        } else if (
          (taskLower.includes("wallet") ||
            taskLower.includes("audit") ||
            taskLower.includes("check") ||
            taskLower.includes("activity")) &&
          address
        ) {
          // SINGLE WALLET DEEP DIVE
          const audit = await auditWallet(address);
          return {
            skill: "bounty-executor",
            task: "wallet-activity",
            dataSource: "Hiro Stacks API (live on-chain data)",
            result: audit,
            paidVia: "x402-stacks",
          };
        } else {
          // CHAIN OVERVIEW (default)
          const snapshot = await getChainSnapshot();
          return {
            skill: "bounty-executor",
            task: task,
            dataSource: "Hiro Stacks API (live on-chain data)",
            result: snapshot,
            note: address
              ? undefined
              : "Provide 'address' for wallet-specific tasks.",
            paidVia: "x402-stacks",
          };
        }
      } catch (err) {
        log.error("Skill:bounty-executor", `Bounty failed: ${err.message}`);
        return {
          skill: "bounty-executor",
          task,
          error: `Bounty execution failed: ${err.message}`,
        };
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Bounty Board (in-memory)
// ---------------------------------------------------------------------------

const bounties = [];

export function postBounty({ title, description, reward, postedBy }) {
  const bounty = {
    id: `bounty-${bounties.length + 1}`,
    title,
    description,
    reward,
    postedBy: postedBy || "anonymous-agent",
    status: "open",
    postedAt: new Date().toISOString(),
    submissions: [],
  };
  bounties.push(bounty);
  return bounty;
}

export function listBounties(status = null) {
  if (status) return bounties.filter((b) => b.status === status);
  return bounties;
}

export function getBounty(bountyId) {
  return bounties.find((b) => b.id === bountyId) || null;
}

export function submitBountyWork({ bountyId, submittedBy, result }) {
  const bounty = getBounty(bountyId);
  if (!bounty) return null;
  if (bounty.status !== "open") return { error: "Bounty is not open" };

  const submission = {
    submittedBy,
    result,
    submittedAt: new Date().toISOString(),
  };
  bounty.submissions.push(submission);
  bounty.status = "submitted";
  return { bounty, submission };
}

/**
 * Update a bounty's reward or description (dynamic negotiation).
 * Agents can negotiate prices before executing work.
 *
 * @param {string} bountyId - The bounty to update
 * @param {Object} updates - { reward?, description?, postedBy? }
 * @returns {Object|null} Updated bounty or error
 */
export function updateBounty(bountyId, updates) {
  const bounty = bounties.find((b) => b.id === bountyId);
  if (!bounty) return null;
  if (bounty.status !== "open") return { error: "Bounty is not open" };

  // Safety check: only the poster can update the reward
  if (updates.postedBy && updates.postedBy !== bounty.postedBy) {
    return { error: "Only the bounty poster can update the reward" };
  }

  const oldReward = bounty.reward;

  if (updates.reward) bounty.reward = updates.reward;
  if (updates.description) bounty.description = updates.description;
  bounty.updatedAt = new Date().toISOString();
  bounty.negotiationHistory = bounty.negotiationHistory || [];
  bounty.negotiationHistory.push({
    action: "reward_updated",
    oldReward,
    newReward: updates.reward || oldReward,
    timestamp: bounty.updatedAt,
  });

  return bounty;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listSkills() {
  return SKILLS.map(({ id, name, description, category, price, asset, acceptedAssets, preview }) => ({
    id,
    name,
    description,
    category,
    price,
    priceSTX: (Number(price) / 1_000_000).toFixed(6) + " STX",
    asset,
    acceptedAssets: acceptedAssets || [{ asset, amount: price, display: (Number(price) / 1_000_000).toFixed(6) + " STX" }],
    preview,
  }));
}

export function getSkill(skillId) {
  return SKILLS.find((s) => s.id === skillId) || null;
}

export async function getSkillPreview(skillId) {
  const skill = getSkill(skillId);
  if (!skill) return null;

  let preview = skill.preview;

  // For alpha-leak, generate a dynamic teaser with counts (FOMO builder)
  if (skillId === "alpha-leak") {
    try {
      const signals = await getAlphaSignals();
      const { whaleCount, trendingCount, largePendingCount } = signals.summary;
      preview =
        `${whaleCount} whale movements detected, ` +
        `${trendingCount} trending contracts, ` +
        `${largePendingCount} large pending txs. ` +
        `Pay to reveal addresses and contract IDs.`;
    } catch (err) {
      // Fall back to static preview on error
      log.warn("Skills", `Alpha preview scan failed: ${err.message}`);
    }
  }

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    price: skill.price,
    priceSTX: (Number(skill.price) / 1_000_000).toFixed(6) + " STX",
    asset: skill.asset,
    acceptedAssets: skill.acceptedAssets || [
      { asset: skill.asset, amount: skill.price, display: (Number(skill.price) / 1_000_000).toFixed(6) + " STX" }
    ],
    preview,
  };
}

export function resolveProviders(providers) {
  return providers.map((p) => ({
    name: p.name,
    address: config.providers[p.addressKey]?.address || "",
    sharePercent: p.sharePercent,
  }));
}
