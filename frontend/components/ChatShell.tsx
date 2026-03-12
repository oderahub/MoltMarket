"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { Bot, Clock3, LoaderCircle, Send, ShieldCheck, Sparkles, User, Wallet } from 'lucide-react';

type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';
type ChatPart = UIMessage['parts'][number];
type ToolPart = Extract<ChatPart, { type: `tool-${string}` }>;
type DynamicToolPart = Extract<ChatPart, { type: 'dynamic-tool' }>;
type ToolLikePart = ToolPart | DynamicToolPart;

interface ChatShellProps {
  messages: UIMessage[];
  status: ChatStatus;
  error?: Error;
  walletAddress: string | null;
  yieldSats: number;
  stakedAmount: number;
  onSubmitPrompt: (prompt: string) => void;
}

type ProgressItem = {
  label: string;
  status?: string;
  detail?: string;
  explorerUrl?: string;
  txId?: string;
};

type TransactionItem = {
  label: string;
  status?: string;
  explorerUrl?: string;
  registryUrl?: string;
  txId?: string;
  asset?: string;
  fundingSource?: string;
  principalPreserved?: boolean;
};

const QUICK_PROMPTS = [
  'Audit the operator wallet, fund it from harvested sBTC yield, and surface the verifiable intent before execution.',
  'Run the alpha leak flow and narrate how yield-funded sBTC unlocks the data without touching stSTXbtc principal.',
  'Settle the high-value bounty in USDCx and explain why stable settlement matters for the operator.',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isToolLikePart(part: ChatPart): part is ToolLikePart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function formatToolName(part: ToolLikePart): string {
  const raw = part.type === 'dynamic-tool' ? part.toolName : part.type.replace(/^tool-/, '');
  return raw.replace(/_/g, ' ');
}

function getOutputStatus(output: unknown): string | null {
  return isRecord(output) && typeof output.status === 'string' ? output.status : null;
}

function getOutputSummary(output: unknown): string | null {
  if (!isRecord(output)) return null;

  const candidates = [output.summary, output.message, output.resultSummary];
  return candidates.find((value): value is string => typeof value === 'string') ?? null;
}

function getOutputIntent(output: unknown): Record<string, unknown> | null {
  return isRecord(output) && isRecord(output.intent) ? output.intent : null;
}

function getVerifiableIntent(output: unknown): Record<string, unknown> | null {
  return isRecord(output) && isRecord(output.verifiableIntent) ? output.verifiableIntent : null;
}

function getStringField(output: unknown, field: string): string | null {
  return isRecord(output) && typeof output[field] === 'string' ? output[field] : null;
}

function getObjectField(output: unknown, field: string): Record<string, unknown> | null {
  return isRecord(output) && isRecord(output[field]) ? output[field] : null;
}

function getUnknownField(output: unknown, field: string): unknown {
  return isRecord(output) ? output[field] : undefined;
}

function getAcceptedHeaders(output: unknown): Array<{ name: string; description?: string }> {
  const paymentRequest = getObjectField(output, 'paymentRequest');
  const paymentContext = getObjectField(output, 'paymentContext');
  const settlement = getObjectField(output, 'settlement');
  const rawHeaderNames =
    (Array.isArray(settlement?.acceptedProofHeaders) ? settlement.acceptedProofHeaders : null) ??
    (Array.isArray(getObjectField(paymentRequest, 'settlement')?.acceptedProofHeaders)
      ? getObjectField(paymentRequest, 'settlement')?.acceptedProofHeaders
      : null);

  if (Array.isArray(rawHeaderNames)) {
    return rawHeaderNames
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((name) => ({
        name,
        description:
          name === 'payment-signature'
            ? 'Base64-encoded x402 payment payload from a signed transaction.'
            : name === 'x-payment-txid'
              ? 'Direct Stacks txid proof accepted by the Express backend.'
              : name === 'x-yield-payment'
                ? 'Yield-engine marker for sBTC-yield-backed demo flows.'
                : undefined,
      }));
  }

  const headers = paymentContext?.acceptedHeaders;
  if (!Array.isArray(headers)) return [];

  return headers
    .filter(isRecord)
    .map((header) => ({
      name: typeof header.name === 'string' ? header.name : 'unknown-header',
      description: typeof header.description === 'string' ? header.description : undefined,
    }));
}

function getProgressItems(output: unknown): ProgressItem[] {
  if (!isRecord(output) || !Array.isArray(output.progress)) return [];

  return output.progress
    .filter(isRecord)
    .map((item) => ({
      label:
        typeof item.label === 'string'
          ? item.label
          : typeof item.title === 'string'
            ? item.title
            : 'Execution step',
      status: typeof item.status === 'string' ? item.status : undefined,
      detail:
        typeof item.detail === 'string'
          ? item.detail
          : typeof item.message === 'string'
            ? item.message
            : undefined,
      explorerUrl:
        typeof item.explorerUrl === 'string'
          ? item.explorerUrl
          : typeof item.url === 'string'
            ? item.url
            : undefined,
      txId: typeof item.txId === 'string' ? item.txId : undefined,
    }));
}

function getExplorerUrl(output: unknown): string | null {
  if (!isRecord(output)) return null;

  const url = output.explorerUrl ?? output.url;
  return typeof url === 'string' ? url : null;
}

function getRegistryLinks(output: unknown): Array<{ label: string; url: string }> {
  if (!isRecord(output) || !isRecord(output.registry)) return [];
  const registry = output.registry as Record<string, unknown>;

  const entries: Array<{ label: string; field: string }> = [
    { label: 'Intent record (API)', field: 'intent' },
    { label: 'Intent attestation (API)', field: 'attestation' },
    { label: 'Settlement log (API)', field: 'settlements' },
  ];

  const contract = isRecord(registry.contract) ? registry.contract : null;
  const contractIdentifier = contract && typeof contract.identifier === 'string'
    ? contract.identifier
    : 'Deployed registry contract';
  const contractExplorerUrl = contract && typeof contract.explorerUrl === 'string'
    ? contract.explorerUrl
    : null;

  const links = entries
    .map(({ label, field }) => {
      const url = registry[field];
      return typeof url === 'string' && url.length > 0 ? { label, url } : null;
    })
    .filter((entry): entry is { label: string; url: string } => Boolean(entry));

  if (contractExplorerUrl) {
    links.unshift({
      label: `Deployed registry contract · ${contractIdentifier}`,
      url: contractExplorerUrl,
    });
  }

  return links;
}

function getTransactions(output: unknown): TransactionItem[] {
  if (!isRecord(output) || !Array.isArray(output.transactions)) return [];

  return output.transactions
    .filter(isRecord)
    .map((item) => ({
      label:
        typeof item.label === 'string'
          ? item.label
          : typeof item.kind === 'string'
            ? item.kind
            : 'Reference',
      status: typeof item.status === 'string' ? item.status : undefined,
      explorerUrl: typeof item.explorerUrl === 'string' ? item.explorerUrl : undefined,
      registryUrl: typeof item.registryUrl === 'string' ? item.registryUrl : undefined,
      txId: typeof item.txid === 'string' ? item.txid : undefined,
      asset: typeof item.asset === 'string' ? item.asset : undefined,
      fundingSource: typeof item.fundingSource === 'string' ? item.fundingSource : undefined,
      principalPreserved: typeof item.principalPreserved === 'boolean' ? item.principalPreserved : undefined,
    }));
}

function getNarration(output: unknown): Record<string, unknown> | null {
  return isRecord(output) && isRecord(output.narration) ? output.narration : null;
}

function formatTimestamp(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date) return value.toLocaleTimeString();

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleTimeString();
  }

  return null;
}

function formatStatusBadge(status: string) {
  if (status === 'error') return 'border-red-500/20 bg-red-500/10 text-red-300';
  if (status === 'payment_required') return 'border-blue-500/20 bg-blue-500/10 text-blue-200';
  return 'border-green-500/20 bg-green-500/10 text-green-400';
}

function toJsonPreview(value: unknown): string | null {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  } catch {
    return null;
  }
}

function ToolCard({ part }: { part: ToolLikePart }) {
  const output = part.state === 'output-available' ? part.output : null;
  const summary = getOutputSummary(output);
  const status = getOutputStatus(output);
  const intent = getOutputIntent(output);
  const verifiableIntent = getVerifiableIntent(output);
  const progressItems = getProgressItems(output);
  const explorerUrl = getExplorerUrl(output);
  const registryLinks = getRegistryLinks(output);
  const transactions = getTransactions(output);
  const narration = getNarration(output);
  const toolName = getStringField(output, 'toolName');
  const skillId = getStringField(output, 'skillId');
  const paymentRequest = getObjectField(output, 'paymentRequest');
  const paymentContext = getObjectField(output, 'paymentContext');
  const payment = getObjectField(output, 'payment');
  const result = getObjectField(output, 'result');
  const rawError = getUnknownField(output, 'error');
  const backendError = getStringField(output, 'error') ?? (isRecord(rawError) ? toJsonPreview(rawError) : null);
  const acceptedHeaders = getAcceptedHeaders(output);
  const inputPreview = useMemo(() => toJsonPreview(part.input), [part.input]);
  const outputPreview = useMemo(() => toJsonPreview(output), [output]);

  return (
    <div className="border border-white/10 bg-black/40 px-4 py-3 text-[10px] text-white/70">
      <div className="mb-2 flex items-center justify-between gap-3 uppercase tracking-[0.18em] text-white/40">
        <span>{formatToolName(part)}</span>
        <span className="border border-white/10 px-2 py-0.5 text-[9px] text-stacks">
          {part.state.replace(/-/g, ' ')}
        </span>
      </div>

      {inputPreview ? <pre className="mb-3 overflow-x-auto whitespace-pre-wrap text-white/45">{inputPreview}</pre> : null}

      {part.state === 'output-available' ? (
        <div className="space-y-3">
          {status ? (
            <div className={`inline-flex border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] ${formatStatusBadge(status)}`}>
              {status}
            </div>
          ) : null}

          {toolName || skillId ? (
            <div className="flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.16em] text-white/40">
              {toolName ? <span className="border border-white/10 px-2 py-1">tool: {toolName}</span> : null}
              {skillId ? <span className="border border-white/10 px-2 py-1">skill: {skillId}</span> : null}
            </div>
          ) : null}

          {summary ? <p className="text-[11px] leading-relaxed text-white/80">{summary}</p> : null}

          {narration ? (
            <div className="grid gap-2 border border-white/10 bg-white/[0.02] p-3 text-[10px] text-white/70 md:grid-cols-2">
              <div>
                <div className="mb-1 uppercase tracking-[0.14em] text-white/40">Treasury rail</div>
                <p>
                  {narration.fundingSource === 'yield'
                    ? 'Harvested sBTC funded this execution while the stSTXbtc principal stayed parked.'
                    : 'Principal-funded payment path is active for this step.'}
                </p>
              </div>
              <div>
                <div className="mb-1 uppercase tracking-[0.14em] text-white/40">Settlement posture</div>
                <p>
                  {typeof narration.settlementAsset === 'string' ? narration.settlementAsset : 'Unknown asset'}
                  {narration.principalPreserved === true ? ' · principal preserved' : ''}
                  {typeof narration.proofStatus === 'string' ? ` · proof ${narration.proofStatus}` : ''}
                </p>
              </div>
            </div>
          ) : null}

          {status === 'payment_required' && paymentContext ? (
            <div className="space-y-2 border border-blue-500/20 bg-blue-500/10 p-3 text-[10px] text-blue-100">
              <div className="uppercase tracking-[0.16em] text-blue-300">Payment authorization required</div>
              {typeof paymentContext.providedHeader === 'string' ? (
                <div className="text-white/70">Provided proof header: {paymentContext.providedHeader}</div>
              ) : null}
              {acceptedHeaders.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-white/60">Accepted proof headers</div>
                  {acceptedHeaders.map((header) => (
                    <div key={header.name} className="border border-white/10 bg-black/20 px-2 py-1 text-white/70">
                      <span className="text-stacks">{header.name}</span>
                      {header.description ? ` — ${header.description}` : ''}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {progressItems.length > 0 ? (
            <div className="space-y-2 border-l border-stacks/30 pl-3">
              {progressItems.map((item, index) => (
                <div key={`${item.label}-${index}`} className="space-y-1">
                  <div className="flex items-center gap-2 uppercase tracking-[0.14em] text-white/45">
                    <span>{item.label}</span>
                    {item.status ? <span className="text-stacks">{item.status}</span> : null}
                  </div>
                  {item.detail ? <p className="text-white/70">{item.detail}</p> : null}
                  {item.explorerUrl ? (
                    <a
                      href={item.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-stacks underline"
                    >
                      Open explorer proof
                    </a>
                  ) : null}
                  {!item.explorerUrl && item.txId ? (
                    <a
                      href={`https://explorer.hiro.so/txid/${item.txId}?chain=testnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-stacks underline"
                    >
                      Verify tx {item.txId.slice(0, 10)}...
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {verifiableIntent || intent ? (
            <div className="border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 uppercase tracking-[0.14em] text-white/40">
                {verifiableIntent ? 'Verifiable intent preview' : 'Thin-layer intent preview'}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-white/65">{toJsonPreview(verifiableIntent ?? intent)}</pre>
            </div>
          ) : null}

          {registryLinks.length > 0 ? (
            <div className="space-y-2 border border-white/10 bg-white/[0.02] p-3 text-[10px] text-white/70">
              <div className="uppercase tracking-[0.14em] text-white/40">Registry references</div>
              {registryLinks.map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-stacks underline"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}

          {paymentRequest ? (
            <div className="border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 uppercase tracking-[0.14em] text-white/40">x402 payment request</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-white/65">{toJsonPreview(paymentRequest)}</pre>
            </div>
          ) : null}

          {payment ? (
            <div className="border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 uppercase tracking-[0.14em] text-white/40">Payment proof</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-white/65">{toJsonPreview(payment)}</pre>
            </div>
          ) : null}

          {result ? (
            <div className="border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 uppercase tracking-[0.14em] text-white/40">Backend result</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-white/65">{toJsonPreview(result)}</pre>
            </div>
          ) : null}

          {transactions.length > 0 ? (
            <div className="space-y-2 border border-white/10 bg-white/[0.02] p-3 text-[10px] text-white/70">
              <div className="uppercase tracking-[0.14em] text-white/40">Explorer-ready references</div>
              {transactions.map((tx, index) => (
                <div key={`${tx.label}-${index}`} className="space-y-1 border border-white/10 bg-black/20 px-2 py-2">
                  <div className="flex flex-wrap items-center gap-2 uppercase tracking-[0.14em] text-white/45">
                    <span>{tx.label}</span>
                    {tx.status ? <span className="text-stacks">{tx.status}</span> : null}
                    {tx.asset ? <span>{tx.asset}</span> : null}
                  </div>
                  {tx.fundingSource ? (
                    <p>
                      {tx.fundingSource === 'yield' ? 'Yield-funded' : 'Principal-funded'}
                      {tx.principalPreserved ? ' · principal preserved' : ''}
                    </p>
                  ) : null}
                  {tx.explorerUrl ? (
                    <a href={tx.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-stacks underline">
                      Open explorer proof
                    </a>
                  ) : null}
                  {!tx.explorerUrl && tx.registryUrl ? (
                    <a href={tx.registryUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-stacks underline">
                      Open registry reference
                    </a>
                  ) : null}
                  {!tx.explorerUrl && !tx.registryUrl && tx.txId ? (
                    <div className="text-white/50">txid: {tx.txId}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {backendError ? <p className="text-[11px] text-red-300">{backendError}</p> : null}

          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-stacks underline"
            >
              Open explorer proof
            </a>
          ) : null}

          {!summary && progressItems.length === 0 && !intent && !paymentRequest && !payment && !result && !backendError && outputPreview ? (
            <pre className="overflow-x-auto whitespace-pre-wrap text-white/55">{outputPreview}</pre>
          ) : null}
        </div>
      ) : null}

      {part.state === 'output-error' ? <p className="text-red-400">{part.errorText}</p> : null}
      {part.state === 'input-available' ? (
        <p className="text-white/55">The route accepted the tool call and is preparing the next streamed step.</p>
      ) : null}
      {part.state === 'input-streaming' ? (
        <p className="text-white/45">Streaming tool input from the App Router orchestrator…</p>
      ) : null}
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const textParts = message.parts.filter((part): part is Extract<ChatPart, { type: 'text' }> => part.type === 'text');
  const toolParts = message.parts.filter(isToolLikePart);
  const messageMeta = message as UIMessage & { metadata?: Record<string, unknown>; createdAt?: unknown };
  const timestamp = formatTimestamp(messageMeta.metadata?.createdAt ?? messageMeta.createdAt);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`w-full max-w-[90%] space-y-3 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-white/35">
          {isUser ? <User size={11} /> : <Bot size={11} className="text-stacks" />}
          <span>{isUser ? 'Operator Prompt' : 'MoltMarket Orchestrator'}</span>
          {timestamp ? (
            <span className="inline-flex items-center gap-1 text-white/25">
              <Clock3 size={10} /> {timestamp}
            </span>
          ) : null}
        </div>

        {textParts.map((part, index) => (
          <div
            key={`${message.id}-text-${index}`}
            className={`border px-4 py-3 text-[13px] leading-relaxed ${
              isUser
                ? 'border-stacks/30 bg-stacks/10 text-white'
                : 'border-white/10 bg-terminal/70 text-white/80'
            }`}
          >
            {part.text}
          </div>
        ))}

        {toolParts.map((part) => (
          <ToolCard key={`${message.id}-${part.toolCallId}`} part={part} />
        ))}
      </div>
    </div>
  );
}

export default function ChatShell({
  messages,
  status,
  error,
  walletAddress,
  yieldSats,
  stakedAmount,
  onSubmitPrompt,
}: ChatShellProps) {
  const [prompt, setPrompt] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isStreaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isStreaming) return;
    onSubmitPrompt(nextPrompt);
    setPrompt('');
  };

  return (
    <section className="flex h-full flex-col bg-terminal/60">
      <div className="border-b border-terminal-border p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/45">
              <Sparkles size={12} className="text-stacks" />
              Chat-first execution shell
            </div>
            <h2 className="text-2xl font-bold uppercase tracking-tight text-white">
              Guide the treasury from one prompt.
            </h2>
          </div>

          <div className="border border-white/10 bg-black/60 px-3 py-2 text-right text-[10px] uppercase tracking-[0.16em] text-white/45">
            <div className="text-stacks">POST /api/chat</div>
            <div>{isStreaming ? 'Streaming hero flow' : 'Thin App Router stream'}</div>
          </div>
        </div>

        <p className="max-w-3xl text-[13px] leading-relaxed text-white/65">
          Preserve principal in <span className="text-white">{stakedAmount.toLocaleString()} stSTXbtc</span>,
          spend only harvested <span className="text-green-400">{yieldSats.toLocaleString()} sats</span>, and keep
          the high-value bounty story on the <span className="text-blue-400">USDCx settlement rail</span>.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="border border-white/10 bg-black/50 p-3 text-[11px] text-white/65">
            <div className="mb-1 flex items-center gap-2 uppercase tracking-[0.18em] text-white/35">
              <Wallet size={11} className="text-stacks" /> Treasury posture
            </div>
            <p>Yield-funded sBTC unlocks execution while the stSTXbtc principal remains intact.</p>
          </div>
          <div className="border border-white/10 bg-black/50 p-3 text-[11px] text-white/65">
            <div className="mb-1 flex items-center gap-2 uppercase tracking-[0.18em] text-white/35">
              <ShieldCheck size={11} className="text-stacks" /> Verification
            </div>
            <p>Tool calls should surface a verifiable intent payload before execution and explorer proof after it.</p>
          </div>
          <div className="border border-white/10 bg-black/50 p-3 text-[11px] text-white/65">
            <div className="mb-1 uppercase tracking-[0.18em] text-white/35">Session mode</div>
            <p>{walletAddress ? `Operator linked: ${walletAddress}` : 'Observer mode until wallet handshake is approved.'}</p>
          </div>
        </div>

        <div className="mt-4 inline-flex items-center gap-2 border border-white/10 bg-black/50 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-white/45">
          <Clock3 size={11} className="text-stacks" />
          {isStreaming ? 'Live: waiting on tool + backend output' : 'Idle: prompt ready'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="space-y-4 border border-dashed border-white/10 bg-black/50 p-5">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">Suggested hero prompts</div>
            <div className="grid gap-3">
              {QUICK_PROMPTS.map((quickPrompt) => (
                <button
                  key={quickPrompt}
                  type="button"
                  onClick={() => onSubmitPrompt(quickPrompt)}
                  disabled={isStreaming}
                  className="border border-white/10 bg-terminal px-4 py-3 text-left text-[12px] leading-relaxed text-white/75 transition hover:border-stacks hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {quickPrompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isStreaming ? (
              <div className="flex items-center gap-2 border border-stacks/20 bg-stacks/10 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/55">
                <LoaderCircle size={13} className="animate-spin text-stacks" /> Streaming route output — watch for intent, payment requirements, and explorer proof.
              </div>
            ) : null}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {error ? <div className="mt-4 border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-300">{error.message}</div> : null}
      </div>

      <div className="border-t border-terminal-border bg-black/70 p-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            placeholder="Ask MoltMarket to audit a wallet, leak alpha, or settle a high-value bounty with verifiable intent…"
            className="w-full resize-none border border-white/10 bg-terminal px-4 py-3 text-[13px] text-white outline-none transition placeholder:text-white/20 focus:border-stacks"
          />

          <div className="flex items-center justify-between gap-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">
              Left panel is chat-first; treasury and terminal proof stay live on the right.
            </p>

            <button
              type="submit"
              disabled={isStreaming || !prompt.trim()}
              className="inline-flex items-center gap-2 bg-stacks px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              <Send size={12} />
              {isStreaming ? 'Streaming…' : 'Send prompt'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}