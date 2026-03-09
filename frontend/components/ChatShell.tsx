"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { Bot, LoaderCircle, Send, ShieldCheck, Sparkles, User, Wallet } from 'lucide-react';

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
  const paymentContext = getObjectField(output, 'paymentContext');
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
  const progressItems = getProgressItems(output);
  const explorerUrl = getExplorerUrl(output);
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
            <div className="inline-flex border border-green-500/20 bg-green-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-green-400">
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

          {intent ? (
            <div className="border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 uppercase tracking-[0.14em] text-white/40">Verifiable intent preview</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-white/65">{toJsonPreview(intent)}</pre>
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

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`w-full max-w-[90%] space-y-3 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-white/35">
          {isUser ? <User size={11} /> : <Bot size={11} className="text-stacks" />}
          <span>{isUser ? 'Operator Prompt' : 'MoltMarket Orchestrator'}</span>
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
            <div>Thin App Router stream</div>
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
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
                <LoaderCircle size={13} className="animate-spin text-stacks" /> Streaming route output…
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