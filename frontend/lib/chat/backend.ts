const DEFAULT_BACKEND_URL =
  process.env.MOLTMARKET_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:3000";

export type ChatExecutionContext = {
  paymentHeader?: {
    name: string;
    value: string;
  };
  txid?: string;
  yieldPaymentTxid?: string;
  walletAddress?: string;
};

type SkillId = "wallet-auditor" | "alpha-leak" | "bounty-executor";
type ToolName = "audit_wallet" | "alpha_leak" | "settle_bounty";

type ExecuteSkillFlowParams = {
  toolName: ToolName;
  skillId: SkillId;
  action: string;
  input: Record<string, unknown>;
  executionContext?: ChatExecutionContext;
  metadata?: Record<string, unknown>;
};

function getBackendBaseUrl() {
  return DEFAULT_BACKEND_URL.endsWith("/")
    ? DEFAULT_BACKEND_URL
    : `${DEFAULT_BACKEND_URL}/`;
}

function buildBackendUrl(path: string) {
  return new URL(path.replace(/^\//, ""), getBackendBaseUrl()).toString();
}

function decodeBase64Json(value: string | null) {
  if (!value) return null;

  try {
    const json = Buffer.from(value, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseJson(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toAbsoluteUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    if (/^https?:\/\//i.test(value)) return value;
    return buildBackendUrl(value);
  } catch {
    return value;
  }
}

function normalizeRegistry(registry: Record<string, unknown> | null | undefined) {
  if (!registry) return null;

  return {
    intent: toAbsoluteUrl(String(registry.intent || registry.intentPath || "")) || null,
    attestation:
      toAbsoluteUrl(String(registry.attestation || registry.attestationPath || "")) || null,
    settlements:
      toAbsoluteUrl(String(registry.settlements || registry.settlementsPath || "")) || null,
  };
}

function normalizeTransactions(transactions: unknown) {
  if (!Array.isArray(transactions)) return [];

  return transactions.map((tx) => {
    const reference = tx as Record<string, unknown>;
    return {
      ...reference,
      explorerUrl: toAbsoluteUrl(typeof reference.explorerUrl === "string" ? reference.explorerUrl : null),
      registryUrl: toAbsoluteUrl(typeof reference.registryUrl === "string" ? reference.registryUrl : null),
    };
  });
}

function buildNarration(body: Record<string, unknown> | null) {
  if (!body) return null;

  const payment = (body.payment as Record<string, unknown> | undefined) || null;
  const settlement = (body.settlement as Record<string, unknown> | undefined) || null;

  if (!payment && !settlement) return null;

  return {
    fundingSource:
      (settlement?.fundingSource as string | undefined) ||
      (payment?.fundingSource as string | undefined) ||
      null,
    principalPreserved: Boolean(
      settlement?.principalPreserved ?? payment?.principalPreserved ?? false
    ),
    settlementAsset:
      (settlement?.asset as string | undefined) || (payment?.asset as string | undefined) || null,
    proofStatus:
      (settlement?.proofStatus as string | undefined) ||
      (payment?.proofStatus as string | undefined) ||
      null,
    explorerReady: Boolean(payment?.explorerUrl),
  };
}

function buildHeaders(
  executionContext?: ChatExecutionContext,
  metadata?: Record<string, unknown>
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (typeof metadata?.preferredAsset === "string" && metadata.preferredAsset) {
    headers["x-payment-asset"] = metadata.preferredAsset;
  }

  if (executionContext?.paymentHeader?.name && executionContext.paymentHeader.value) {
    headers[executionContext.paymentHeader.name] = executionContext.paymentHeader.value;
  }

  if (executionContext?.txid) {
    headers["x-payment-txid"] = executionContext.txid;
  }

  if (executionContext?.yieldPaymentTxid) {
    headers["x-yield-payment"] = executionContext.yieldPaymentTxid;
  }

  return headers;
}

function buildIntent({
  toolName,
  skillId,
  action,
  input,
  metadata,
}: {
  toolName: ToolName;
  skillId: SkillId;
  action: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const backendPath = `/skills/${skillId}/execute`;

  return {
    id: `${toolName}-${Date.now()}`,
    toolName,
    skillId,
    action,
    createdAt: new Date().toISOString(),
    input,
    metadata: metadata || {},
    backendRequest: {
      baseUrl: DEFAULT_BACKEND_URL,
      path: backendPath,
      method: "POST",
    },
    architecture: {
      layer: "thin-nextjs-chat-api",
      sourceOfTruth: "existing-express-x402-backend",
      noRecursiveHiring: true,
    },
  };
}

function buildPaymentContext(executionContext?: ChatExecutionContext) {
  const providedHeader = executionContext?.paymentHeader?.name
    ? executionContext.paymentHeader.name
    : executionContext?.txid
      ? "x-payment-txid"
      : executionContext?.yieldPaymentTxid
        ? "x-yield-payment"
        : null;

  return {
    providedHeader,
    acceptedHeaders: [
      {
        name: "payment-signature",
        description: "Base64-encoded x402 payment payload from a signed transaction.",
      },
      {
        name: "x-payment-txid",
        description: "Direct Stacks txid proof accepted by the existing Express middleware.",
      },
      {
        name: "x-yield-payment",
        description: "Yield-engine payment marker for sBTC-yield-backed demo flows.",
      },
    ],
  };
}

export async function executeSkillFlow({
  toolName,
  skillId,
  action,
  input,
  executionContext,
  metadata,
}: ExecuteSkillFlowParams) {
  const backendPath = `/skills/${skillId}/execute`;
  const intent = buildIntent({ toolName, skillId, action, input, metadata });
  const progress = [
    {
      id: "intent",
      label: "Prepared thin-layer intent payload",
      status: "complete",
    },
  ];

  try {
    const response = await fetch(buildBackendUrl(backendPath), {
      method: "POST",
      headers: buildHeaders(executionContext, metadata),
      body: JSON.stringify(input),
      cache: "no-store",
    });

    const rawBody = await response.text();
    const body = parseJson(rawBody);

    if (response.status === 402) {
      const paymentRequest = body || decodeBase64Json(response.headers.get("payment-required"));
      return {
        status: "payment_required",
        toolName,
        skillId,
        summary: `${action} is staged and waiting on x402 payment authorization.`,
        intent,
        progress: [
          ...progress,
          {
            id: "x402",
            label: "Received x402 payment requirements from backend",
            status: "payment_required",
          },
          {
            id: "execution",
            label: "Awaiting payment proof before execution",
            status: "pending",
          },
        ],
        paymentRequest,
        settlement: body?.settlement ?? paymentRequest?.settlement ?? null,
        verifiableIntent: body?.verifiableIntent ?? paymentRequest?.verifiableIntent ?? null,
        registry: normalizeRegistry((body?.registry as Record<string, unknown> | undefined) || (paymentRequest?.registry as Record<string, unknown> | undefined) || null),
        transactions: normalizeTransactions(body?.transactions),
        narration: buildNarration(body),
        paymentContext: buildPaymentContext(executionContext),
        result: null,
      };
    }

    if (!response.ok) {
      return {
        status: "error",
        toolName,
        skillId,
        summary: `${action} failed at the backend boundary.`,
        intent,
        progress: [
          ...progress,
          {
            id: "execution",
            label: "Backend execution failed",
            status: "error",
          },
        ],
        settlement: body?.settlement ?? null,
        verifiableIntent: body?.verifiableIntent ?? null,
        registry: normalizeRegistry(body?.registry as Record<string, unknown> | undefined),
        transactions: normalizeTransactions(body?.transactions),
        narration: buildNarration(body),
        paymentContext: buildPaymentContext(executionContext),
        error: body || rawBody || `Backend responded with ${response.status}`,
      };
    }

    return {
      status: "completed",
      toolName,
      skillId,
      summary: `${action} completed through the existing Express/x402 backend.`,
      intent,
      progress: [
        ...progress,
        {
          id: "execution",
          label: "Backend execution completed",
          status: "complete",
        },
      ],
      paymentContext: buildPaymentContext(executionContext),
      payment: body?.payment ?? null,
      settlement: body?.settlement ?? null,
      verifiableIntent: body?.verifiableIntent ?? null,
      registry: normalizeRegistry(body?.registry as Record<string, unknown> | undefined),
      transactions: normalizeTransactions(body?.transactions),
      narration: buildNarration(body),
      result: body,
    };
  } catch (error) {
    return {
      status: "error",
      toolName,
      skillId,
      summary: `${action} could not reach the backend.`,
      intent,
      progress: [
        ...progress,
        {
          id: "execution",
          label: "Backend request could not be completed",
          status: "error",
        },
      ],
      paymentContext: buildPaymentContext(executionContext),
      error: error instanceof Error ? error.message : "Unknown backend error",
    };
  }
}