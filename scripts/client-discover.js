/**
 * client-discover.js — Agent discovers the MoltMarket marketplace.
 *
 * Shows: browse skills, preview one, get 402 requirements.
 * Usage: npm run client:discover
 * Prereq: Server running (npm start)
 */

const BASE_URL = process.env.SERVER_URL || "http://localhost:3000";

async function main() {
  console.log("🤖 MoltMarket Agent — Discovery Flow\n");

  // Step 1: Browse skills
  console.log("📋 Step 1: Browsing marketplace...\n");
  const skillsRes = await fetch(`${BASE_URL}/skills`);
  const skillsData = await skillsRes.json();

  console.log(`Found ${skillsData.count} skills:\n`);
  for (const skill of skillsData.skills) {
    console.log(`  🔧 ${skill.name} (${skill.id})`);
    console.log(`     Price: ${skill.priceSTX} | Category: ${skill.category}`);
    console.log(`     ${skill.description.slice(0, 100)}...`);
    console.log("");
  }

  // Step 2: Preview wallet-auditor
  console.log("🔍 Step 2: Previewing 'wallet-auditor'...\n");
  const previewRes = await fetch(`${BASE_URL}/skills/wallet-auditor`);
  console.log(JSON.stringify(await previewRes.json(), null, 2));

  // Step 3: Get 402 requirements
  console.log("\n💳 Step 3: Requesting execution without payment...\n");
  const execRes = await fetch(`${BASE_URL}/skills/wallet-auditor/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM" }),
  });

  console.log(`HTTP Status: ${execRes.status}`);
  if (execRes.status === 402) {
    const req = await execRes.json();
    console.log("\n✅ Got 402 Payment Required!");
    console.log(`   Amount: ${req.accepts[0].amount} microSTX`);
    console.log(`   Pay to: ${req.accepts[0].payTo}`);
    console.log(`   Asset:  ${req.accepts[0].asset}`);
  }

  // Step 4: Browse bounties
  console.log("\n📌 Step 4: Checking bounty board...\n");
  const bountiesRes = await fetch(`${BASE_URL}/bounties`);
  const bountiesData = await bountiesRes.json();
  console.log(`${bountiesData.count} bounties posted.`);

  console.log("\n🏁 Discovery complete! Run `npm run client:pay` to purchase a skill.\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
