/**
 * config.js — Loads environment variables and exports validated configuration.
 *
 * This module reads from .env via dotenv and provides a single config object
 * used by all other modules. It validates that required fields are present
 * at startup so we fail fast rather than mid-request.
 */

import dotenv from "dotenv";
dotenv.config();

const config = {
  // Network
  stacksNetwork: process.env.STACKS_NETWORK || "testnet",
  stacksApiUrl:
    process.env.STACKS_API_URL || "https://api.testnet.hiro.so",

  // sBTC contract addresses (SIP-010 token)
  // Mainnet: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
  // Testnet: ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token (mock)
  sbtcContract:
    process.env.SBTC_CONTRACT ||
    (process.env.STACKS_NETWORK === "mainnet"
      ? "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
      : "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token"),

  // Platform wallet
  platformPrivateKey: process.env.PLATFORM_PRIVATE_KEY || "",
  platformAddress: process.env.PLATFORM_ADDRESS || "",

  // Provider wallets (for multi-hop payment demo)
  providers: {
    a: {
      privateKey: process.env.PROVIDER_A_PRIVATE_KEY || "",
      address: process.env.PROVIDER_A_ADDRESS || "",
    },
    b: {
      privateKey: process.env.PROVIDER_B_PRIVATE_KEY || "",
      address: process.env.PROVIDER_B_ADDRESS || "",
    },
    c: {
      privateKey: process.env.PROVIDER_C_PRIVATE_KEY || "",
      address: process.env.PROVIDER_C_ADDRESS || "",
    },
  },

  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",

  // Payment
  platformFeePercent: parseInt(process.env.PLATFORM_FEE_PERCENT || "40", 10),

  // Facilitator (optional)
  facilitatorUrl: process.env.FACILITATOR_URL || null,
};

/**
 * Validates that critical config values are present.
 * Called at server startup. Logs warnings for missing optional values.
 * Throws if truly required values are missing.
 */
export function validateConfig() {
  const warnings = [];
  const errors = [];

  if (!config.platformPrivateKey) {
    errors.push(
      "PLATFORM_PRIVATE_KEY is not set. Run: npm run setup:wallets"
    );
  }
  if (!config.platformAddress) {
    errors.push("PLATFORM_ADDRESS is not set. Run: npm run setup:wallets");
  }

  // Provider wallets are needed for multi-hop demo but not for basic operation
  const providerKeys = ["a", "b", "c"];
  for (const key of providerKeys) {
    if (!config.providers[key].address) {
      warnings.push(
        `PROVIDER_${key.toUpperCase()}_ADDRESS not set. Multi-hop payments to provider ${key} will be skipped.`
      );
    }
  }

  if (warnings.length > 0) {
    console.warn("\n⚠️  Configuration warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }

  if (errors.length > 0) {
    console.error("\n❌ Configuration errors:");
    errors.forEach((e) => console.error(`   - ${e}`));
    console.error("\nRun: npm run setup:wallets to generate wallet keys.\n");
    throw new Error("Missing required configuration. See errors above.");
  }
}

export default config;
