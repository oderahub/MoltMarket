/**
 * setup-wallets.js — Generates Stacks wallets for all MoltMarket roles.
 *
 * Creates:
 * - 1 platform wallet (receives payments from agents)
 * - 3 provider wallets (receive revenue distributions)
 * - 1 demo agent wallet (for the client demo scripts)
 *
 * Outputs the values you need to copy into your .env file.
 *
 * Usage: npm run setup:wallets
 *
 * IMPORTANT: These are testnet wallets. Never use testnet keys on mainnet.
 * After generating wallets, you need to fund them with the testnet faucet:
 *   https://platform.hiro.so/faucet
 * or via API:
 *   POST https://api.testnet.hiro.so/extended/v1/faucets/stx?address=ST...&stacking=false
 */

import pkg from "@stacks/transactions";
const { randomPrivateKey, getAddressFromPrivateKey } = pkg;

function generateWallet(label) {
  const privateKey = randomPrivateKey();
  const address = getAddressFromPrivateKey(privateKey, "testnet");
  return { label, privateKey, address };
}

console.log("🔑 MoltMarket Wallet Generator");
console.log("================================\n");
console.log("Generating testnet wallets...\n");

const platform = generateWallet("Platform");
const providerA = generateWallet("Provider A");
const providerB = generateWallet("Provider B");
const providerC = generateWallet("Provider C");
const demoAgent = generateWallet("Demo Agent");

console.log("✅ Wallets generated!\n");

// Print wallet details
const wallets = [platform, providerA, providerB, providerC, demoAgent];
for (const w of wallets) {
  console.log(`📦 ${w.label}:`);
  console.log(`   Address:     ${w.address}`);
  console.log(`   Private Key: ${w.privateKey}`);
  console.log("");
}

// Print .env block
console.log("================================================");
console.log("📋 Copy the following into your .env file:");
console.log("================================================\n");

console.log(`# Platform wallet`);
console.log(`PLATFORM_PRIVATE_KEY=${platform.privateKey}`);
console.log(`PLATFORM_ADDRESS=${platform.address}`);
console.log("");
console.log(`# Provider wallets (for multi-hop revenue distribution)`);
console.log(`PROVIDER_A_PRIVATE_KEY=${providerA.privateKey}`);
console.log(`PROVIDER_A_ADDRESS=${providerA.address}`);
console.log("");
console.log(`PROVIDER_B_PRIVATE_KEY=${providerB.privateKey}`);
console.log(`PROVIDER_B_ADDRESS=${providerB.address}`);
console.log("");
console.log(`PROVIDER_C_PRIVATE_KEY=${providerC.privateKey}`);
console.log(`PROVIDER_C_ADDRESS=${providerC.address}`);
console.log("");

// Print demo agent wallet separately (used by client scripts, not .env)
console.log("================================================");
console.log("📋 Demo Agent Wallet (for client scripts):");
console.log("================================================\n");
console.log(`DEMO_AGENT_PRIVATE_KEY=${demoAgent.privateKey}`);
console.log(`DEMO_AGENT_ADDRESS=${demoAgent.address}`);
console.log("");

// Print funding instructions
console.log("================================================");
console.log("💰 Next: Fund these wallets with testnet STX");
console.log("================================================\n");
console.log("Option 1: Visit https://platform.hiro.so/faucet");
console.log("Option 2: Run these curl commands:\n");

for (const w of wallets) {
  console.log(`# Fund ${w.label} (${w.address})`);
  console.log(
    `curl -X POST "https://api.testnet.hiro.so/extended/v1/faucets/stx?address=${w.address}&stacking=false"`
  );
  console.log("");
}

console.log("Each faucet request gives 500 STX. Tokens arrive after ~10 minutes.");
console.log("You need to fund at least the Platform and Demo Agent wallets.");
console.log("");
