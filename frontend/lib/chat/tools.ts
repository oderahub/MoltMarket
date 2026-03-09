import { tool } from "ai";
import { z } from "zod";
import { ChatExecutionContext, executeSkillFlow } from "@/lib/chat/backend";

export function createChatTools(executionContext?: ChatExecutionContext) {
  return {
    audit_wallet: tool({
      description:
        "Audit a Stacks wallet through the existing wallet-auditor backend skill when the user asks for a wallet review, holdings analysis, risk scan, or address audit.",
      inputSchema: z.object({
        address: z.string().describe("The Stacks address to audit."),
        focus: z
          .string()
          .optional()
          .describe("Optional focus for the audit, such as risk, holdings, or activity."),
      }),
      execute: async ({ address, focus }) =>
        executeSkillFlow({
          toolName: "audit_wallet",
          skillId: "wallet-auditor",
          action: "Wallet audit request",
          input: { address },
          executionContext,
          metadata: { focus, preferredAsset: "STX" },
        }),
    }),
    alpha_leak: tool({
      description:
        "Fetch premium alpha signals through the existing alpha-leak backend skill when the user wants whale flow, trending contract, or mempool intelligence.",
      inputSchema: z.object({
        focus: z
          .enum(["whale-movements", "trending-contracts", "pending-transactions", "all"])
          .optional()
          .describe("Optional alpha focus area."),
        thesis: z
          .string()
          .optional()
          .describe("Optional short note describing what signal the user is chasing."),
      }),
      execute: async ({ focus, thesis }) =>
        executeSkillFlow({
          toolName: "alpha_leak",
          skillId: "alpha-leak",
          action: "Alpha leak request",
          input: {},
          executionContext,
          metadata: { focus: focus || "all", thesis },
        }),
    }),
    settle_bounty: tool({
      description:
        "Execute a bounty-style intelligence task through the existing bounty-executor backend skill when the user wants a bounty settled, executed, or compared across addresses.",
      inputSchema: z.object({
        task: z.string().describe("The bounty or execution task to perform."),
        address: z
          .string()
          .optional()
          .describe("Primary Stacks address for wallet-specific bounty work."),
        addresses: z
          .array(z.string())
          .optional()
          .describe("Multiple addresses for comparison-style bounty work."),
        bountyId: z
          .string()
          .optional()
          .describe("Optional external bounty identifier for UI correlation."),
        preferredAsset: z
          .enum(["STX", "sBTC", "USDCx"])
          .optional()
          .describe("Preferred settlement asset to highlight in the intent payload."),
      }),
      execute: async ({ task, address, addresses, bountyId, preferredAsset }) =>
        executeSkillFlow({
          toolName: "settle_bounty",
          skillId: "bounty-executor",
          action: "Bounty settlement request",
          input: {
            task,
            ...(address ? { address } : {}),
            ...(addresses?.length ? { addresses } : {}),
          },
          executionContext,
          metadata: {
            bountyId,
            preferredAsset: preferredAsset || "USDCx",
          },
        }),
    }),
  };
}