/**
 * treasury.js — StackingDAO integration for yield-powered agents.
 *
 * Provides:
 * - stSTXbtc balance queries (liquid staking position)
 * - sBTC reward tracking and claims
 * - Yield-to-payment routing for x402
 *
 * Contract References:
 * - stSTXbtc Core: SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.stacking-dao-core-btc-v3
 * - sBTC Token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
 *
 * @see https://docs.stackingdao.com/stackingdao/core-contracts/ststxbtc-stacking-dao-core-btc-v3
 */

import { getFullBalances } from "../utils/hiro.js";
import config from "../config.js";
import log from "../utils/logger.js";

// StackingDAO contract addresses
const STACKING_DAO = {
  stSTXbtc: {
    core: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.stacking-dao-core-btc-v3",
    token: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token",
  },
  stSTX: {
    core: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.stacking-dao-core-v6",
    token: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token",
  },
  sBTC: {
    token: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
  },
};

/**
 * Get stSTXbtc balance for an address.
 * stSTXbtc is a SIP-010 token, so it appears in fungible_tokens.
 *
 * @param {string} address - Stacks address to query
 * @returns {Promise<{raw: string, formatted: string, hasPosition: boolean}>}
 */
export async function getStSTXbtcBalance(address) {
  try {
    const balances = await getFullBalances(address);
    const ftTokens = balances.fungible_tokens || {};

    // Look for stSTXbtc in fungible tokens
    const stSTXbtcKey = Object.keys(ftTokens).find(
      (key) =>
        key.includes("ststxbtc") || key.includes("stacking-dao-core-btc")
    );

    if (stSTXbtcKey) {
      const balance = ftTokens[stSTXbtcKey].balance;
      return {
        raw: balance,
        formatted: (Number(balance) / 1_000_000).toFixed(6),
        hasPosition: Number(balance) > 0,
      };
    }

    return { raw: "0", formatted: "0.000000", hasPosition: false };
  } catch (err) {
    log.error("Treasury", `Failed to get stSTXbtc balance: ${err.message}`);
    return { raw: "0", formatted: "0.000000", hasPosition: false };
  }
}

/**
 * Get sBTC balance (rewards from stSTXbtc).
 *
 * @param {string} address - Stacks address to query
 * @returns {Promise<{raw: string, sats: number, btc: string}>}
 */
export async function getsBTCBalance(address) {
  try {
    const balances = await getFullBalances(address);
    const ftTokens = balances.fungible_tokens || {};

    const sBTCKey = Object.keys(ftTokens).find((key) =>
      key.toLowerCase().includes("sbtc")
    );

    if (sBTCKey) {
      const balance = ftTokens[sBTCKey].balance;
      // sBTC uses 8 decimals (satoshis)
      return {
        raw: balance,
        sats: Number(balance),
        btc: (Number(balance) / 100_000_000).toFixed(8),
      };
    }

    return { raw: "0", sats: 0, btc: "0.00000000" };
  } catch (err) {
    log.error("Treasury", `Failed to get sBTC balance: ${err.message}`);
    return { raw: "0", sats: 0, btc: "0.00000000" };
  }
}

/**
 * Get treasury summary for an agent (stSTXbtc + sBTC rewards).
 *
 * @param {string} address - Stacks address to query
 * @returns {Promise<Object>} Treasury summary with balances and yield estimates
 */
export async function getTreasurySummary(address) {
  log.info("Treasury", `Fetching treasury for ${address}`);

  const [stSTXbtc, sBTC] = await Promise.all([
    getStSTXbtcBalance(address),
    getsBTCBalance(address),
  ]);

  // Estimate daily yield (approximate 6% APY on stSTXbtc)
  const stakedValue = Number(stSTXbtc.raw) / 1_000_000;
  const dailyYieldSats = Math.floor(((stakedValue * 0.06) / 365) * 100_000_000);

  return {
    stSTXbtc: {
      balance: stSTXbtc.formatted,
      balanceRaw: stSTXbtc.raw,
      hasPosition: stSTXbtc.hasPosition,
    },
    sBTC: {
      balanceSats: sBTC.sats,
      balanceBTC: sBTC.btc,
    },
    yield: {
      estimatedDailySats: dailyYieldSats,
      currentCycle: 114, // Would fetch from PoX contract in production
      cycleProgress: 67, // Percentage through current cycle
    },
    canPayWithYield: sBTC.sats > 0,
    contracts: STACKING_DAO,
    queriedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Simulated yield for demo purposes
// In production, this would track actual reward distributions from StackingDAO
// ---------------------------------------------------------------------------

let simulatedYield = 1420; // Starting yield in sats

/**
 * Get current simulated yield balance.
 * @returns {number} Current yield in sats
 */
export function getSimulatedYield() {
  return simulatedYield;
}

/**
 * Accrue simulated yield (mimics StackingDAO reward distribution).
 * @param {number|null} amount - Specific amount to accrue, or random 1-3 sats
 * @returns {number} New yield balance
 */
export function accrueSimulatedYield(amount = null) {
  const accrual = amount ?? Math.floor(Math.random() * 3) + 1;
  simulatedYield += accrual;
  log.info("Treasury", `[STACKING_DAO] Yield accrued: +${accrual} sats (total: ${simulatedYield})`);
  return simulatedYield;
}

/**
 * Spend simulated yield for x402 payment.
 * @param {number} amount - Amount to spend in sats
 * @returns {{success: boolean, remaining: number, needed?: number}}
 */
export function spendSimulatedYield(amount) {
  if (simulatedYield >= amount) {
    simulatedYield -= amount;
    log.success("Treasury", `[YIELD_ENGINE] Spent ${amount} sats via yield (remaining: ${simulatedYield})`);
    return { success: true, remaining: simulatedYield };
  }
  log.warn("Treasury", `[YIELD_ENGINE] Insufficient yield: have ${simulatedYield}, need ${amount}`);
  return { success: false, remaining: simulatedYield, needed: amount };
}

/**
 * Reset simulated yield (for testing).
 * @param {number} amount - New yield balance
 */
export function resetSimulatedYield(amount = 1420) {
  simulatedYield = amount;
  return simulatedYield;
}

export { STACKING_DAO };
