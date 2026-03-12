import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import type { ChatExecutionContext } from "@/lib/chat/backend";
import { getChatModel } from "@/lib/chat/model";
import { createChatTools } from "@/lib/chat/tools";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are MoltMarket's thin chat orchestrator for the V2 demo.

Rules:
- Use tools for wallet audits, alpha signals, and bounty settlement requests.
- Route work through the existing Express/x402 backend only; never invent backend results.
- If a tool returns payment_required, explain that execution is staged and summarize the intent + payment request.
- Never claim a payment, txid, or explorer link unless it is present in tool output.
- Preserve the thin-layer architecture and do not suggest recursive hiring or spawning agents.`;

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown chat route error";
}

export async function POST(request: Request) {
  try {
    const {
      messages,
      executionContext,
    }: {
      messages: UIMessage[];
      executionContext?: ChatExecutionContext;
    } = await request.json();

    const result = streamText({
      model: getChatModel(),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: createChatTools(executionContext),
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse({
      onError: toErrorMessage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: toErrorMessage(error),
      },
      { status: 500 }
    );
  }
}