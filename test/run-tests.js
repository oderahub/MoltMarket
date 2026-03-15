/**
 * run-tests.js — Tests for MoltMarket v2.
 * Usage: npm test
 */

import { existsSync, rmSync } from "fs";
import { join } from "path";
import { once } from "events";

process.env.MOLTMARKET_LEDGER_FILE = join(process.cwd(), ".tmp-ledger-test.json");
process.env.MOLTMARKET_INTENT_FILE = join(process.cwd(), ".tmp-intents-test.json");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
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

async function withPatchedGlobals(patches, fn) {
  const originals = patches.map(({ object, key }) => ({ object, key, value: object[key] }));
  try {
    for (const { object, key, value } of patches) object[key] = value;
    return await fn();
  } finally {
    for (const original of originals) original.object[original.key] = original.value;
  }
}

async function withTestServer(router, fn) {
  const express = (await import("express")).default;
  const http = await import("http");

  const app = express();
  app.use(express.json());
  app.use("/", router);

  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function exerciseDirectTxidProof({
  router,
  getSkill,
  getIntent,
  listSettlements,
  skillId = "alpha-leak",
  requestedAsset,
  txid,
  fetchResponder,
  includeIntentId = true,
  retryRequestedAsset = requestedAsset,
  retryIntentId = null,
  initialInput = { task: "test-proof-validation" },
  retryInput = initialInput,
}) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const skill = getSkill(skillId);
  let executeCalls = 0;

  return withPatchedGlobals(
    [
      {
        object: skill,
        key: "execute",
        value: async () => {
          executeCalls += 1;
          return { ok: true };
        },
      },
      {
        object: skill,
        key: "providers",
        value: [],
      },
      {
        object: globalThis,
        key: "fetch",
        value: async (input, init) => {
          const url = typeof input === "string" ? input : input?.url || String(input);
          if (url.includes("/extended/v1/tx/")) {
            return fetchResponder(url, init);
          }
          return nativeFetch(input, init);
        },
      },
    ],
    async () => withTestServer(router, async (baseUrl) => {
      const initialResponse = await nativeFetch(`${baseUrl}/skills/${skillId}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-payment-asset": requestedAsset,
        },
        body: JSON.stringify(initialInput),
      });
      assertEqual(initialResponse.status, 402, "initial quote status");

      const initialBody = await initialResponse.json();

      const intentId = initialResponse.headers.get("x-intent-id");
      assert(intentId, "missing x-intent-id header");

      const executionHeaders = {
        "Content-Type": "application/json",
        ...(retryRequestedAsset ? { "x-payment-asset": retryRequestedAsset } : {}),
        ...(includeIntentId ? { "x-intent-id": retryIntentId || intentId } : {}),
        "x-payment-txid": txid,
      };

      const response = await nativeFetch(`${baseUrl}/skills/${skillId}/execute`, {
        method: "POST",
        headers: executionHeaders,
        body: JSON.stringify(retryInput),
      });

      const body = await response.json();
      return {
        initialBody,
        response,
        body,
        executeCalls,
        intentId,
        intent: getIntent(intentId),
        settlements: listSettlements({ intentId }),
      };
    })
  );
}

async function withSimulatedYield({ getSimulatedYield, resetSimulatedYield }, amount, fn) {
  const originalYield = getSimulatedYield();
  resetSimulatedYield(amount);
  try {
    return await fn();
  } finally {
    resetSimulatedYield(originalYield);
  }
}

function buildMockSip10TransferTx({
  contractId,
  amount,
  recipient,
  sender = "STTESTPAYER",
  status = "success",
  functionName = "transfer",
}) {
  return {
    tx_status: status,
    tx_type: "contract_call",
    sender_address: sender,
    contract_call: {
      contract_id: contractId,
      function_name: functionName,
      function_args: [
        { repr: `u${amount}` },
        { repr: `'${sender}` },
        { repr: `'${recipient}` },
        { repr: "none" },
      ],
    },
  };
}

async function exerciseYieldPayment({
  router,
  getSkill,
  getIntent,
  listSettlements,
  getSimulatedYield,
  resetSimulatedYield,
  requestedAsset = null,
  initialYield,
  yieldTxid = `yield-payment-${Date.now()}`,
}) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const skill = getSkill("bounty-executor");
  let executeCalls = 0;

  return withPatchedGlobals(
    [
      {
        object: skill,
        key: "execute",
        value: async () => {
          executeCalls += 1;
          return { ok: true };
        },
      },
      {
        object: skill,
        key: "providers",
        value: [],
      },
    ],
    async () => withSimulatedYield({ getSimulatedYield, resetSimulatedYield }, initialYield, async () => {
      return withTestServer(router, async (baseUrl) => {
        const initialHeaders = {
          "Content-Type": "application/json",
        };
        if (requestedAsset) initialHeaders["x-payment-asset"] = requestedAsset;

        const initialResponse = await nativeFetch(`${baseUrl}/skills/bounty-executor/execute`, {
          method: "POST",
          headers: initialHeaders,
          body: JSON.stringify({ task: "test-yield-validation" }),
        });
        assertEqual(initialResponse.status, 402, "initial quote status");

        const initialBody = await initialResponse.json();
        const intentId = initialResponse.headers.get("x-intent-id");
        assert(intentId, "missing x-intent-id header");

        const executionHeaders = {
          "Content-Type": "application/json",
          "x-intent-id": intentId,
          "x-yield-payment": yieldTxid,
        };
        if (requestedAsset) executionHeaders["x-payment-asset"] = requestedAsset;

        const response = await nativeFetch(`${baseUrl}/skills/bounty-executor/execute`, {
          method: "POST",
          headers: executionHeaders,
          body: JSON.stringify({ task: "test-yield-validation" }),
        });

        const body = await response.json();
        return {
          initialBody,
          response,
          body,
          executeCalls,
          intentId,
          intent: getIntent(intentId),
          settlements: listSettlements({ intentId }),
          remainingYield: getSimulatedYield(),
        };
      });
    })
  );
}

async function main() {
  const {
    listSkills, getSkill, getSkillPreview,
    postBounty, listBounties, getBounty,
  } = await import("../src/services/skills.js");
  const {
    buildPaymentRequired,
    encodePaymentHeader,
    decodePaymentHeader,
    buildPaymentPayload,
    buildPaymentResponse,
    PAYMENT_HEADER,
    getPaymentFailureReason,
    getStacksNetworkId,
    isExecutionUnlockedPayment,
    resolveSettlementQuote,
  } = await import("../src/utils/x402.js");
  const {
    recordIncomingPayment,
    getLedger,
    getLedgerSummary,
    listSettlements,
  } = await import("../src/services/ledger.js");
  const {
    createOrHydrateIntent,
    getIntent,
    getIntentAttestation,
    listIntents,
    markIntentPaymentRequired,
    recordIntentSettlement,
    completeIntent,
  } = await import("../src/services/intents.js");
  const { getSimulatedYield, resetSimulatedYield } = await import("../src/services/treasury.js");
  const router = (await import("../src/routes/api.js")).default;

  console.log("\n🧪 MoltMarket v2 Tests\n");

  console.log("--- Skills Registry ---");

  await test("listSkills returns 4 skills", () => {
    assertEqual(listSkills().length, 4, "skill count");
  });

  await test("skill IDs are correct (v2 upgraded)", () => {
    const ids = listSkills().map((s) => s.id);
    assert(ids.includes("wallet-auditor"), "missing wallet-auditor");
    assert(ids.includes("stacks-intel"), "missing stacks-intel");
    assert(ids.includes("alpha-leak"), "missing alpha-leak");
    assert(ids.includes("bounty-executor"), "missing bounty-executor");
  });

  await test("skills are categorized as bitcoin-intelligence or bounty-orchestration", () => {
    const cats = listSkills().map((s) => s.category);
    assert(cats.includes("bitcoin-intelligence"), "missing bitcoin-intelligence category");
    assert(cats.includes("bounty-orchestration"), "missing bounty-orchestration category");
  });

  await test("getSkill returns full skill with async execute", () => {
    const skill = getSkill("wallet-auditor");
    assert(skill !== null);
    assertEqual(skill.id, "wallet-auditor");
    assert(typeof skill.execute === "function", "execute should be function");
    assert(Array.isArray(skill.providers));
  });

  await test("getSkill returns null for nonexistent", () => {
    assertEqual(getSkill("nope"), null);
  });

  await test("getSkillPreview excludes execute and providers", async () => {
    const p = await getSkillPreview("stacks-intel");
    assert(p !== null);
    assert(p.preview);
    assert(!p.execute);
    assert(!p.providers);
  });

  await test("multi-asset skills expose accepted assets", () => {
    const alpha = listSkills().find((skill) => skill.id === "alpha-leak");
    assert(alpha.acceptedAssets.length >= 3, "alpha-leak should expose multi-asset pricing");
  });

  await test("bounty executor defaults to USDCx in accepted asset ordering", () => {
    const bounty = listSkills().find((skill) => skill.id === "bounty-executor");
    assertEqual(bounty.acceptedAssets[0].asset, "USDCx");
  });

  await test("all skills have valid prices", () => {
    for (const s of listSkills()) {
      const n = Number(s.price);
      assert(!isNaN(n) && n > 0, `${s.id}: bad price`);
    }
  });

  console.log("\n--- x402 Protocol ---");

  await test("PAYMENT_HEADER is 'payment-signature'", () => {
    assertEqual(PAYMENT_HEADER, "payment-signature");
  });

  await test("buildPaymentRequired structure", () => {
    const r = buildPaymentRequired({ payTo: "ST1X", amount: "5000", resource: "/test" });
    assertEqual(r.x402Version, 2);
    assertEqual(r.accepts[0].amount, "5000");
    assertEqual(r.accepts[0].scheme, "exact");
    assertEqual(r.accepts[0].network, getStacksNetworkId());
  });

  await test("buildPaymentRequired carries multi-asset contract metadata", () => {
    const r = buildPaymentRequired({
      payTo: "ST1X",
      amount: "10000",
      resource: "/skills/alpha-leak/execute",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "sBTC", amount: "1000" },
        { asset: "USDCx", amount: "10000" },
      ],
    });
    const sbtc = r.accepts.find((option) => option.asset === "sBTC");
    const usdcx = r.accepts.find((option) => option.asset === "USDCx");
    assert(sbtc.contractAddress, "sBTC contract metadata missing");
    assert(usdcx.contractAddress, "USDCx contract metadata missing");
  });

  await test("resolveSettlementQuote prefers the requested asset", () => {
    const quote = resolveSettlementQuote({
      requestedAsset: "sBTC",
      amount: "10000",
      asset: "STX",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "sBTC", amount: "1000" },
      ],
    });
    assertEqual(quote.asset, "sBTC");
    assertEqual(quote.amount, "1000");
  });

  await test("encode/decode are inverse", () => {
    const orig = { a: 1, b: [2, 3] };
    const decoded = decodePaymentHeader(encodePaymentHeader(orig));
    assertEqual(JSON.stringify(decoded), JSON.stringify(orig));
  });

  await test("buildPaymentPayload structure", () => {
    const p = buildPaymentPayload({ transactionHex: "aabb" });
    assertEqual(p.x402Version, 2);
    assertEqual(p.payload.transaction, "aabb");
  });

  await test("buildPaymentResponse is base64 JSON", () => {
    const r = buildPaymentResponse({ success: true, txid: "0xabc", asset: "STX", intentId: "intent-1" });
    const d = JSON.parse(Buffer.from(r, "base64").toString("utf-8"));
    assertEqual(d.success, true);
    assertEqual(d.txid, "0xabc");
    assertEqual(d.intentId, "intent-1");
  });

  await test("execution unlock helper only accepts finalized proof states", () => {
    assertEqual(isExecutionUnlockedPayment({ verified: true, proofStatus: "verified-onchain" }), true);
    assertEqual(isExecutionUnlockedPayment({ verified: true, proofStatus: "yield-helper" }), true);
    assertEqual(isExecutionUnlockedPayment({ verified: false, proofStatus: "pending-onchain" }), false);
    assertEqual(isExecutionUnlockedPayment({ verified: false, proofStatus: "tx-found-asset-unconfirmed" }), false);
  });

  await test("payment failure reason explains mismatched proof", () => {
    assertEqual(
      getPaymentFailureReason({ verified: false, proofStatus: "tx-found-asset-unconfirmed" }),
      "Payment proof does not match the selected settlement asset or contract."
    );
  });

  console.log("\n--- Intent Registry ---");

  await test("intent lifecycle is persisted with verification digests", () => {
    const skill = getSkill("alpha-leak");
    const intent = createOrHydrateIntent({
      skill,
      input: { task: "reveal-alpha" },
      request: { method: "POST", path: "/skills/alpha-leak/execute" },
      metadata: { requestedAsset: "sBTC" },
    });
    markIntentPaymentRequired(intent.id, { paymentRequestPath: "/skills/alpha-leak/execute" });
    recordIntentSettlement(intent.id, {
      txid: "0xintent",
      asset: "sBTC",
      amount: "1000",
      method: "direct-txid",
      verified: true,
    });
    completeIntent(intent.id, {
      ledgerEntryId: 1,
      paymentTxid: "0xintent",
      result: { ok: true },
      revenueDistribution: [{ name: "provider-a", amount: "600" }],
    });

    const stored = getIntent(intent.id);
    assertEqual(stored.status, "completed");
    assert(stored.verification.intentDigest, "intent digest missing");
    assert(stored.verification.settlementDigest, "settlement digest missing");
    assert(stored.verifiableIntent, "verifiable intent payload missing");
    assert(stored.verifiableIntent.spendLimits.length >= 1, "spend limits missing");
    assertEqual(stored.verifiableIntent.registry.attestationPath, `/registry/intents/${intent.id}/attestation`);
    assertEqual(
      stored.verifiableIntent.registry.contract.path,
      "contracts/verifiable-intent-registry.clar"
    );
    assertEqual(
      stored.verifiableIntent.registry.contract.identifier,
      "ST2FY55DK4NESNH6E5CJSNZP2CQ5PZ5BX65KWG39S.verifiable-intent-registry"
    );
    assertEqual(stored.verifiableIntent.registry.contract.deploymentStatus, "deployed-testnet");
    assertEqual(stored.verifiableIntent.registry.mode, "api-attested");
    const attestation = getIntentAttestation(intent.id);
    assert(attestation, "attestation missing");
    assertEqual(attestation.status, "ready");
    assertEqual(attestation.mode, "api-attested");
  });

  await test("yield-funded settlements preserve principal in stored payment metadata", () => {
    const skill = getSkill("bounty-executor");
    const intent = createOrHydrateIntent({
      skill,
      input: { bounty: "test" },
      request: { method: "POST", path: "/skills/bounty-executor/execute" },
      metadata: { requestedAsset: "sBTC" },
    });

    recordIntentSettlement(intent.id, {
      txid: "yield-payment-demo",
      asset: "sBTC",
      amount: "800",
      method: "yield-payment",
      yieldPowered: true,
      verified: true,
    });

    const stored = getIntent(intent.id);
    assertEqual(stored.settlement.payment.fundingSource, "yield");
    assertEqual(stored.settlement.payment.principalPreserved, true);
    assertEqual(stored.settlement.payment.proofStatus, "yield-helper");
  });

  await test("invalid proof attempts do not settle intents", () => {
    const skill = getSkill("alpha-leak");
    const intent = createOrHydrateIntent({
      skill,
      input: { task: "reveal-alpha" },
      request: { method: "POST", path: "/skills/alpha-leak/execute" },
      metadata: { requestedAsset: "USDCx" },
    });

    const updated = recordIntentSettlement(intent.id, {
      txid: "0xwrong",
      asset: "USDCx",
      amount: "10000",
      method: "direct-txid",
      verified: false,
      proofStatus: "tx-found-asset-unconfirmed",
    });

    assertEqual(updated.status, "payment_required");
    assertEqual(updated.settlement.payment.verified, false);
    assertEqual(updated.settlement.payment.proofStatus, "tx-found-asset-unconfirmed");

    const completed = completeIntent(intent.id, {
      ledgerEntryId: 99,
      paymentTxid: "0xwrong",
      result: { ok: true },
      revenueDistribution: [],
    });

    assertEqual(completed.status, "payment_required");
  });

  console.log("\n--- Payment Gate & Execute Route ---");

  await test("USDCx-selected flow rejects STX txid proof before execution", async () => {
    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xstx-proof",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          tx_status: "success",
          tx_type: "token_transfer",
          sender_address: "STTESTPAYER",
        }),
      }),
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.intent.status, "payment_required");
    assertEqual(result.intent.settlement.payment, null);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "tx-found-asset-unconfirmed");
    assertEqual(result.settlements.length, 0);
  });

  await test("USDCx-selected flow rejects wrong-contract proof before execution", async () => {
    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xwrong-contract",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          tx_status: "success",
          tx_type: "contract_call",
          contract_call: {
            contract_id: "STWRONG.contract-token",
          },
          sender_address: "STTESTPAYER",
        }),
      }),
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.intent.status, "payment_required");
    assertEqual(result.intent.settlement.payment, null);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "tx-found-asset-unconfirmed");
    assertEqual(result.settlements.length, 0);
  });

  await test("pending direct-txid proof fails closed before execution", async () => {
    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xpending-proof",
      fetchResponder: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "not found" }),
      }),
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.intent.status, "payment_required");
    assertEqual(result.intent.settlement.payment, null);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "pending-onchain");
    assertEqual(result.settlements.length, 0);
  });

  await test("unverifiable direct-txid proof fails closed before execution", async () => {
    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xnetwork-error",
      fetchResponder: async () => {
        throw new Error("hiro unavailable");
      },
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.intent.status, "payment_required");
    assertEqual(result.intent.settlement.payment, null);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "verification-unavailable");
    assertEqual(result.settlements.length, 0);
  });

  await test("matching USDCx proof still unlocks execution and settlement", async () => {
    const usdcxQuote = resolveSettlementQuote({
      requestedAsset: "USDCx",
      amount: "10000",
      asset: "STX",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "USDCx", amount: "10000" },
      ],
    });

    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xusdcx-proof",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () =>
          buildMockSip10TransferTx({
            contractId: usdcxQuote.contractAddress,
            amount: usdcxQuote.amount,
            recipient: usdcxQuote.payTo,
          }),
      }),
    });

    assertEqual(result.response.status, 200);
    assertEqual(result.executeCalls, 1);
    assertEqual(result.body.success, true);
    assertEqual(result.intent.status, "completed");
    assertEqual(result.intent.settlement.payment.verified, true);
    assertEqual(result.intent.settlement.payment.proofStatus, "verified-onchain");
    assertEqual(result.settlements.length, 1);
  });

  await test("matching USDCx contract proof with wrong staged amount is rejected before execution", async () => {
    const usdcxQuote = resolveSettlementQuote({
      requestedAsset: "USDCx",
      amount: "10000",
      asset: "STX",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "USDCx", amount: "10000" },
      ],
    });

    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xwrong-amount",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () =>
          buildMockSip10TransferTx({
            contractId: usdcxQuote.contractAddress,
            amount: "9999",
            recipient: usdcxQuote.payTo,
          }),
      }),
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "tx-found-quote-unconfirmed");
    assertEqual(result.body.payment.verificationDetails.expectedAmount, "10000");
    assertEqual(result.body.payment.verificationDetails.observedAmount, "9999");
    assertEqual(result.settlements.length, 0);
  });

  await test("matching USDCx contract proof with wrong payTo recipient is rejected before execution", async () => {
    const usdcxQuote = resolveSettlementQuote({
      requestedAsset: "USDCx",
      amount: "10000",
      asset: "STX",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "USDCx", amount: "10000" },
      ],
    });

    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      txid: "0xwrong-recipient",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () =>
          buildMockSip10TransferTx({
            contractId: usdcxQuote.contractAddress,
            amount: usdcxQuote.amount,
            recipient: "STWRONGPAYTOADDRESS0000000000000000000000",
          }),
      }),
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "tx-found-quote-unconfirmed");
    assertEqual(result.body.payment.verificationDetails.payToMatchConfirmed, false);
    assertEqual(result.settlements.length, 0);
  });

  await test("staged USDCx direct-txid retry succeeds without repeating x-payment-asset when x-intent-id is preserved", async () => {
    const usdcxQuote = resolveSettlementQuote({
      requestedAsset: "USDCx",
      amount: "10000",
      asset: "STX",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "USDCx", amount: "10000" },
      ],
    });

    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      retryRequestedAsset: null,
      txid: "0xstaged-usdcx-proof",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () =>
          buildMockSip10TransferTx({
            contractId: usdcxQuote.contractAddress,
            amount: usdcxQuote.amount,
            recipient: usdcxQuote.payTo,
          }),
      }),
    });

    assertEqual(result.initialBody.settlement.selected.asset, "USDCx");
    assertEqual(result.response.status, 200);
    assertEqual(result.executeCalls, 1);
    assertEqual(result.intent.status, "completed");
    assertEqual(result.intent.settlement.payment.verified, true);
    assertEqual(result.settlements.length, 1);
  });

  await test("successful direct-txid proof is rejected when staged x-intent-id continuity is missing", async () => {
    const usdcxQuote = resolveSettlementQuote({
      requestedAsset: "USDCx",
      amount: "10000",
      asset: "STX",
      acceptedAssets: [
        { asset: "STX", amount: "10000" },
        { asset: "USDCx", amount: "10000" },
      ],
    });

    const result = await exerciseDirectTxidProof({
      router,
      getSkill,
      getIntent,
      listSettlements,
      requestedAsset: "USDCx",
      includeIntentId: false,
      txid: "0xmissing-intent-link",
      fetchResponder: async () => ({
        ok: true,
        status: 200,
        json: async () =>
          buildMockSip10TransferTx({
            contractId: usdcxQuote.contractAddress,
            amount: usdcxQuote.amount,
            recipient: usdcxQuote.payTo,
          }),
      }),
    });

    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "tx-found-intent-unconfirmed");
    assertEqual(result.body.payment.verificationDetails.intentLinkConfirmed, false);
    assertEqual(result.settlements.length, 0);
  });

  await test("eligible sBTC yield payment spends simulated yield before execution", async () => {
    const result = await exerciseYieldPayment({
      router,
      getSkill,
      getIntent,
      listSettlements,
      getSimulatedYield,
      resetSimulatedYield,
      requestedAsset: "sBTC",
      initialYield: 1200,
      yieldTxid: "yield-payment-success",
    });

    assertEqual(result.initialBody.settlement.selected.asset, "sBTC");
    assert(result.initialBody.settlement.acceptedProofHeaders.includes("x-yield-payment"));
    assertEqual(result.response.status, 200);
    assertEqual(result.executeCalls, 1);
    assertEqual(result.remainingYield, 400);
    assertEqual(result.intent.status, "completed");
    assertEqual(result.intent.settlement.payment.asset, "sBTC");
    assertEqual(result.intent.settlement.payment.verified, true);
    assertEqual(result.intent.settlement.payment.proofStatus, "yield-helper");
    assertEqual(result.settlements.length, 1);
  });

  await test("insufficient simulated yield fails closed before execution", async () => {
    const result = await exerciseYieldPayment({
      router,
      getSkill,
      getIntent,
      listSettlements,
      getSimulatedYield,
      resetSimulatedYield,
      requestedAsset: "sBTC",
      initialYield: 100,
      yieldTxid: "yield-payment-insufficient",
    });

    assertEqual(result.initialBody.settlement.selected.asset, "sBTC");
    assert(result.initialBody.settlement.acceptedProofHeaders.includes("x-yield-payment"));
    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.remainingYield, 100);
    assertEqual(result.intent.status, "payment_required");
    assertEqual(result.intent.settlement.payment, null);
    assertEqual(result.body.error, "Insufficient simulated yield for the selected settlement amount.");
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "yield-helper");
    assertEqual(result.body.payment.verificationDetails.availableYield, 100);
    assertEqual(result.body.payment.verificationDetails.neededAmount, 800);
    assertEqual(result.settlements.length, 0);
  });

  await test("non-eligible selected settlement rejects yield helper header", async () => {
    const result = await exerciseYieldPayment({
      router,
      getSkill,
      getIntent,
      listSettlements,
      getSimulatedYield,
      resetSimulatedYield,
      initialYield: 1200,
      yieldTxid: "yield-payment-ineligible",
    });

    assertEqual(result.initialBody.settlement.selected.asset, "USDCx");
    assert(!result.initialBody.settlement.acceptedProofHeaders.includes("x-yield-payment"));
    assertEqual(result.response.status, 402);
    assertEqual(result.executeCalls, 0);
    assertEqual(result.remainingYield, 1200);
    assertEqual(result.intent.status, "payment_required");
    assertEqual(result.intent.settlement.payment, null);
    assertEqual(result.body.error, "Yield-backed payment is only available for sBTC settlement quotes.");
    assertEqual(result.body.payment.asset, "USDCx");
    assertEqual(result.body.payment.verified, false);
    assertEqual(result.body.payment.proofStatus, "yield-helper");
    assertEqual(result.settlements.length, 0);
  });

  await test("listIntents filters by status and asset", () => {
    const intents = listIntents({ status: "completed", asset: "sBTC" });
    assert(intents.length >= 1, "expected at least one completed sBTC intent");
  });

  console.log("\n--- Bounty Board ---");

  await test("postBounty creates bounty", () => {
    const b = postBounty({ title: "Test bounty", description: "Desc", reward: "1000" });
    assert(b.id.startsWith("bounty-"));
    assertEqual(b.status, "open");
    assertEqual(b.title, "Test bounty");
  });

  await test("listBounties returns posted bounties", () => {
    const all = listBounties();
    assert(all.length >= 1);
  });

  await test("getBounty returns specific bounty", () => {
    const b = postBounty({ title: "B2", description: "D2", reward: "2000" });
    const found = getBounty(b.id);
    assertEqual(found.title, "B2");
  });

  await test("getBounty returns null for nonexistent", () => {
    assertEqual(getBounty("bounty-999"), null);
  });

  await test("listBounties filters by status", () => {
    const open = listBounties("open");
    for (const b of open) assertEqual(b.status, "open");
  });

  console.log("\n--- Ledger ---");

  await test("recordIncomingPayment creates entry with settlement metadata", () => {
    const e = recordIncomingPayment({
      txid: "0xt1",
      from: "ST1",
      amount: "5000",
      skillId: "wallet-auditor",
      asset: "STX",
      intentId: "intent-stx",
      settlementMethod: "payment-signature",
    });
    assert(e.id > 0);
    assertEqual(e.amount, "5000");
    assertEqual(e.asset, "STX");
  });

  await test("recordIncomingPayment supports non-STX settlement assets", () => {
    recordIncomingPayment({
      txid: "0xt2",
      from: "ST1",
      amount: "1000",
      skillId: "alpha-leak",
      asset: "sBTC",
      intentId: "intent-sbtc",
      settlementMethod: "direct-txid",
    });
    const settlements = listSettlements({ asset: "sBTC", txid: "0xt2" });
    assertEqual(settlements.length, 1);
    assertEqual(settlements[0].intentId, "intent-sbtc");
  });

  await test("getLedger returns entries", () => {
    assert(Array.isArray(getLedger()));
    assert(getLedger().length >= 2);
  });

  await test("getLedgerSummary computes per-asset totals", () => {
    const s = getLedgerSummary();
    assertEqual(s.totalPayments, 5);
    assertEqual(s.totalIncomingMicroSTX, "5000");
    assertEqual(s.totalsByAsset.sBTC.incoming, "1800");
    assertEqual(s.totalsByAsset.USDCx.incoming, "20000");
  });

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(40)}\n`);

  for (const file of [process.env.MOLTMARKET_LEDGER_FILE, process.env.MOLTMARKET_INTENT_FILE]) {
    if (file && existsSync(file)) rmSync(file);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
