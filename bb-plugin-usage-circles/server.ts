// bb-plugin-usage-circles — backend entry. Reads Claude Code's usage limits
// through the BB SDK (bb.sdk.system.usageLimits) and exposes them, plus the
// three sidebar-ring visibility switches, over one RPC method. No parsing of
// provider files — see memory/decisions/usage-rings-own-code.md.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { normalizeUsage, selectClaudeCodeProvider } from "./lib/usage-model";
import { createUsageLimitsCache } from "./lib/usage-cache";

// Anthropic's account usage endpoint is tightly rate-limited; every open
// sidebar polls this plugin independently, so without coalescing, a few open
// tabs alone were enough to trip "rate limited, try again shortly" for
// everyone. See lib/service/usage-limits-cache.ts.
const USAGE_CACHE_TTL_MS = 20_000;

const usageResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    windows: z.array(z.object({ label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable() })),
  }),
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export const rpcContract = defineRpcContract({
  getState: {
    input: z.null(),
    output: z.object({
      toggles: z.object({
        fiveHour: z.boolean(),
        weekly: z.boolean(),
        fable: z.boolean(),
      }),
      openOnHover: z.boolean(),
      usage: usageResultSchema,
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    fiveHour: { type: "boolean", label: "5-hour window ring in the footer", default: true },
    weekly: { type: "boolean", label: "Weekly window ring in the footer", default: true },
    fable: { type: "boolean", label: "Fable weekly window ring in the footer", default: true },
    openOnHover: { type: "boolean", label: "Show panel on hover", default: true },
  });

  const usageLimitsCache = createUsageLimitsCache(() => bb.sdk.system.usageLimits(), USAGE_CACHE_TTL_MS);

  bb.rpc.register(rpcContract, {
    async getState() {
      const { fiveHour, weekly, fable, openOnHover } = await settings.get();
      // The Claude Code provider sits under the hyphenated key "claude-code"
      // (selectClaudeCodeProvider knows about the mismatch with the SDK type).
      const claudeCode = selectClaudeCodeProvider(await usageLimitsCache.get());
      return { toggles: { fiveHour, weekly, fable }, openOnHover, usage: normalizeUsage(claudeCode) };
    },
  });
}
