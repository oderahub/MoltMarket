import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { LogEntry } from '@/hooks/useTerminal';

type ChatPart = UIMessage['parts'][number];
type ToolPart = Extract<ChatPart, { type: `tool-${string}` }>;
type DynamicToolPart = Extract<ChatPart, { type: 'dynamic-tool' }>;
type ToolLikePart = ToolPart | DynamicToolPart;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isToolLikePart(part: ChatPart): part is ToolLikePart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function toolLabel(part: ToolLikePart): string {
  const name = part.type === 'dynamic-tool' ? part.toolName : part.type.replace(/^tool-/, '');
  return name.replace(/_/g, ' ');
}

function getSummary(output: unknown): string | null {
  if (!isRecord(output)) return null;
  const value = output.summary ?? output.message ?? output.resultSummary;
  return typeof value === 'string' ? value : null;
}

function getStatus(output: unknown): string | null {
  return isRecord(output) && typeof output.status === 'string' ? output.status : null;
}

function getIntent(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output)) return null;
  if (isRecord(output.verifiableIntent)) return output.verifiableIntent;
  return isRecord(output.intent) ? output.intent : null;
}

function getNarration(output: unknown): Record<string, unknown> | null {
  return isRecord(output) && isRecord(output.narration) ? output.narration : null;
}

function getRegistryUrls(output: unknown): string[] {
  if (!isRecord(output) || !isRecord(output.registry)) return [];

  const contract = isRecord(output.registry.contract) ? output.registry.contract : null;
  const urls = [
    output.registry.intent,
    output.registry.attestation,
    output.registry.settlements,
    contract?.explorerUrl,
  ];
  return urls.filter((value): value is string => typeof value === 'string' && value.startsWith('http'));
}

function getRegistryContractIdentifier(output: unknown): string | null {
  if (!isRecord(output) || !isRecord(output.registry) || !isRecord(output.registry.contract)) {
    return null;
  }

  const identifier = output.registry.contract.identifier;
  return typeof identifier === 'string' ? identifier : null;
}

function getTransactionLines(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.transactions)) return [];

  return output.transactions
    .filter(isRecord)
    .map((tx) => {
      const label = typeof tx.label === 'string' ? tx.label : 'reference';
      const asset = typeof tx.asset === 'string' ? tx.asset : null;
      const fundingSource = typeof tx.fundingSource === 'string' ? tx.fundingSource : null;
      const principalPreserved = tx.principalPreserved === true ? 'principal preserved' : null;
      return [label, asset, fundingSource, principalPreserved].filter(Boolean).join(' · ');
    })
    .filter(Boolean);
}

function getOutputError(output: unknown): string | null {
  if (!isRecord(output)) return null;
  if (typeof output.error === 'string') return output.error;
  if (isRecord(output.error)) return JSON.stringify(output.error).slice(0, 240);
  return null;
}

function getAcceptedHeaderNames(output: unknown): string[] {
  if (!isRecord(output)) return [];

  const settlement = isRecord(output.settlement) ? output.settlement : null;
  const paymentRequest = isRecord(output.paymentRequest) ? output.paymentRequest : null;
  const paymentRequestSettlement = paymentRequest && isRecord(paymentRequest.settlement)
    ? paymentRequest.settlement
    : null;

  const rawHeaderNames =
    (Array.isArray(settlement?.acceptedProofHeaders) ? settlement.acceptedProofHeaders : null) ??
    (Array.isArray(paymentRequestSettlement?.acceptedProofHeaders)
      ? paymentRequestSettlement.acceptedProofHeaders
      : null);

  if (Array.isArray(rawHeaderNames)) {
    return rawHeaderNames.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  }

  if (!isRecord(output.paymentContext) || !Array.isArray(output.paymentContext.acceptedHeaders)) {
    return [];
  }

  return output.paymentContext.acceptedHeaders
    .filter(isRecord)
    .map((header) => (typeof header.name === 'string' ? header.name : null))
    .filter((value): value is string => Boolean(value));
}

function getUrls(output: unknown): string[] {
  if (!isRecord(output)) return [];

  const urls = new Set<string>();
  const pushIfUrl = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('http')) {
      urls.add(value);
    }
  };

  pushIfUrl(output.explorerUrl);
  pushIfUrl(output.url);

  if (Array.isArray(output.progress)) {
    for (const step of output.progress) {
      if (!isRecord(step)) continue;
      pushIfUrl(step.explorerUrl);
      pushIfUrl(step.url);
    }
  }

  return Array.from(urls);
}

function getProgressLines(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.progress)) return [];

  return output.progress
    .filter(isRecord)
    .map((step) => {
      const label = typeof step.label === 'string' ? step.label : typeof step.title === 'string' ? step.title : 'Execution step';
      const detail = typeof step.detail === 'string' ? step.detail : typeof step.message === 'string' ? step.message : '';
      return detail ? `${label} — ${detail}` : label;
    });
}

export function useChatTerminalBridge(
  messages: UIMessage[],
  addLog: (message: string, type: LogEntry['type']) => void,
) {
  const seenEventsRef = useRef(new Set<string>());

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts.filter(isToolLikePart)) {
        const eventKey = `${message.id}:${part.toolCallId}:${part.state}`;
        if (seenEventsRef.current.has(eventKey)) continue;

        if (part.state === 'input-available') {
          seenEventsRef.current.add(eventKey);
          addLog(`[CHAT_ROUTE] ${toolLabel(part)} requested`, 'agent');
          continue;
        }

        if (part.state === 'output-error') {
          seenEventsRef.current.add(eventKey);
          addLog(`[CHAT_ROUTE] ${toolLabel(part)} failed`, 'error');
          addLog(part.errorText, 'error');
          continue;
        }

        if (part.state !== 'output-available') {
          continue;
        }

        seenEventsRef.current.add(eventKey);

        const label = toolLabel(part);
        const status = getStatus(part.output) ?? 'completed';
        addLog(`[CHAT_ROUTE] ${label} ${status}`, status === 'error' ? 'error' : 'success');

        const summary = getSummary(part.output);
        if (summary) addLog(summary, 'info');

        const narration = getNarration(part.output);
        if (narration) {
          if (narration.fundingSource === 'yield') {
            addLog('[TREASURY] Harvested sBTC funded execution; stSTXbtc principal stayed parked.', 'success');
          }

          if (typeof narration.settlementAsset === 'string') {
            addLog(`[SETTLEMENT] ${narration.settlementAsset} rail selected`, narration.settlementAsset === 'USDCx' ? 'success' : 'info');
          }

          if (typeof narration.proofStatus === 'string') {
            addLog(`[PROOF] ${narration.proofStatus}`, 'system');
          }
        }

        const progressLines = getProgressLines(part.output);
        for (const line of progressLines.slice(0, 4)) {
          addLog(`[${label}] ${line}`, 'system');
        }

        for (const line of getTransactionLines(part.output).slice(0, 4)) {
          addLog(`[REFERENCE] ${line}`, 'info');
        }

        if (status === 'payment_required') {
          const headerNames = getAcceptedHeaderNames(part.output);
          if (headerNames.length > 0) {
            addLog(`[PAYMENT] Accepted headers: ${headerNames.join(', ')}`, 'info');
          }
        }

        const intent = getIntent(part.output);
        if (intent) {
          addLog(`[INTENT] ${JSON.stringify(intent).slice(0, 240)}`, 'system');
        }

        const registryContractIdentifier = getRegistryContractIdentifier(part.output);
        if (registryContractIdentifier) {
          addLog(`[REGISTRY] ${registryContractIdentifier}`, 'system');
        }

        for (const url of getRegistryUrls(part.output)) {
          addLog(`Registry: ${url}`, 'info');
        }

        const outputError = getOutputError(part.output);
        if (outputError) {
          addLog(`[${label}] ${outputError}`, status === 'error' ? 'error' : 'info');
        }

        for (const url of getUrls(part.output)) {
          addLog(`Explorer: ${url}`, 'success');
        }
      }
    }
  }, [messages, addLog]);
}