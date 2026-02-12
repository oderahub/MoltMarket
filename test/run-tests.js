/**
 * run-tests.js — Tests for MoltMarket v2.
 * Usage: npm test
 */

import {
  listSkills, getSkill, getSkillPreview,
  postBounty, listBounties, getBounty,
} from "../src/services/skills.js";
import {
  buildPaymentRequired, encodePaymentHeader, decodePaymentHeader,
  buildPaymentPayload, buildPaymentResponse, PAYMENT_HEADER,
} from "../src/utils/x402.js";
import {
  recordIncomingPayment, getLedger, getLedgerSummary,
} from "../src/services/ledger.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
function assertEqual(a, b, label = "") {
  if (a !== b) throw new Error(`${label ? label + ": " : ""}Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ===========================================================================
console.log("\n🧪 MoltMarket v2 Tests\n");

console.log("--- Skills Registry ---");

test("listSkills returns 3 skills", () => {
  assertEqual(listSkills().length, 3, "skill count");
});

test("skill IDs are correct (v2 upgraded)", () => {
  const ids = listSkills().map((s) => s.id);
  assert(ids.includes("wallet-auditor"), "missing wallet-auditor");
  assert(ids.includes("stacks-intel"), "missing stacks-intel");
  assert(ids.includes("bounty-executor"), "missing bounty-executor");
});

test("skills are categorized as bitcoin-intelligence or bounty-orchestration", () => {
  const cats = listSkills().map((s) => s.category);
  assert(cats.includes("bitcoin-intelligence"), "missing bitcoin-intelligence category");
  assert(cats.includes("bounty-orchestration"), "missing bounty-orchestration category");
});

test("getSkill returns full skill with async execute", () => {
  const skill = getSkill("wallet-auditor");
  assert(skill !== null);
  assertEqual(skill.id, "wallet-auditor");
  assert(typeof skill.execute === "function", "execute should be function");
  assert(Array.isArray(skill.providers));
});

test("getSkill returns null for nonexistent", () => {
  assertEqual(getSkill("nope"), null);
});

test("getSkillPreview excludes execute and providers", () => {
  const p = getSkillPreview("stacks-intel");
  assert(p !== null);
  assert(p.preview);
  assert(!p.execute);
  assert(!p.providers);
});

test("all skills have valid prices", () => {
  for (const s of listSkills()) {
    const n = Number(s.price);
    assert(!isNaN(n) && n > 0, `${s.id}: bad price`);
  }
});

test("skills describe real data sources", () => {
  for (const s of listSkills()) {
    assert(
      s.description.includes("Hiro") || s.description.includes("on-chain") || s.description.includes("orchestrat"),
      `${s.id}: should mention real data source`
    );
  }
});

// ===========================================================================
console.log("\n--- x402 Protocol ---");

test("PAYMENT_HEADER is 'payment-signature'", () => {
  assertEqual(PAYMENT_HEADER, "payment-signature");
});

test("buildPaymentRequired structure", () => {
  const r = buildPaymentRequired({ payTo: "ST1X", amount: "5000", resource: "/test" });
  assertEqual(r.x402Version, 2);
  assertEqual(r.accepts[0].amount, "5000");
  assertEqual(r.accepts[0].scheme, "exact");
  assertEqual(r.accepts[0].network, "stacks:1");
});

test("encode/decode are inverse", () => {
  const orig = { a: 1, b: [2, 3] };
  const decoded = decodePaymentHeader(encodePaymentHeader(orig));
  assertEqual(JSON.stringify(decoded), JSON.stringify(orig));
});

test("buildPaymentPayload structure", () => {
  const p = buildPaymentPayload({ transactionHex: "aabb" });
  assertEqual(p.x402Version, 2);
  assertEqual(p.payload.transaction, "aabb");
});

test("buildPaymentResponse is base64 JSON", () => {
  const r = buildPaymentResponse({ success: true, txid: "0xabc" });
  const d = JSON.parse(Buffer.from(r, "base64").toString("utf-8"));
  assertEqual(d.success, true);
  assertEqual(d.txid, "0xabc");
});

// ===========================================================================
console.log("\n--- Bounty Board ---");

test("postBounty creates bounty", () => {
  const b = postBounty({ title: "Test bounty", description: "Desc", reward: "1000" });
  assert(b.id.startsWith("bounty-"));
  assertEqual(b.status, "open");
  assertEqual(b.title, "Test bounty");
});

test("listBounties returns posted bounties", () => {
  const all = listBounties();
  assert(all.length >= 1);
});

test("getBounty returns specific bounty", () => {
  const b = postBounty({ title: "B2", description: "D2", reward: "2000" });
  const found = getBounty(b.id);
  assertEqual(found.title, "B2");
});

test("getBounty returns null for nonexistent", () => {
  assertEqual(getBounty("bounty-999"), null);
});

test("listBounties filters by status", () => {
  const open = listBounties("open");
  for (const b of open) assertEqual(b.status, "open");
});

// ===========================================================================
console.log("\n--- Ledger ---");

test("recordIncomingPayment creates entry", () => {
  const e = recordIncomingPayment({ txid: "0xt1", from: "ST1", amount: "5000", skillId: "wallet-auditor" });
  assert(e.id > 0);
  assertEqual(e.amount, "5000");
});

test("getLedger returns entries", () => {
  assert(Array.isArray(getLedger()));
  assert(getLedger().length >= 1);
});

test("getLedgerSummary computes totals", () => {
  recordIncomingPayment({ txid: "0xt2", from: "ST1", amount: "3000", skillId: "stacks-intel" });
  const s = getLedgerSummary();
  assert(s.totalPayments >= 2);
  assert(BigInt(s.totalIncomingMicroSTX) >= 8000n);
});

// ===========================================================================
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(40)}\n`);
if (failed > 0) process.exit(1);
