import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

export function getChatModel() {
  const provider = (process.env.AI_PROVIDER || process.env.CHAT_PROVIDER || "openai").toLowerCase();

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY for AI_PROVIDER=openai.");
    }

    return openai(process.env.OPENAI_CHAT_MODEL || process.env.CHAT_MODEL || "gpt-4o-mini");
  }

  if (provider === "google") {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY for AI_PROVIDER=google.");
    }

    return google(process.env.GOOGLE_CHAT_MODEL || process.env.CHAT_MODEL || "gemini-2.5-flash");
  }

  if (provider !== "anthropic") {
    throw new Error(`Unsupported chat provider \"${provider}\". Use openai, anthropic, or google.`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY for AI_PROVIDER=anthropic.");
  }

  return anthropic(
    process.env.ANTHROPIC_CHAT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-5-20250929"
  );
}