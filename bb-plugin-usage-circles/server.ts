// bb-plugin-usage-circles — backend entry. Reads Claude Code's and Codex's
// usage limits through the BB SDK (bb.sdk.system.usageLimits), their logos and
// brand tints from the host's provider list, and exposes them — plus the ring
// switches and the coloring settings — over one RPC method. No parsing of
// provider files — see memory/decisions/usage-rings-own-code.md.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  COLORING_OPTIONS,
  normalizeUsage,
  parseColoring,
  selectProvider,
  type ProviderStateWire,
  type ProviderTint,
  type StateWire,
} from "./lib/usage-model";
import { createUsageLimitsCache } from "./lib/usage-cache";

// Anthropic's account usage endpoint is tightly rate-limited; every open
// sidebar polls this plugin independently, so without coalescing, a few open
// tabs alone were enough to trip "rate limited, try again shortly" for
// everyone. See lib/usage-cache.ts.
const USAGE_CACHE_TTL_MS = 20_000;

/** The providers the footer shows, in footer order. */
export const PROVIDERS = [
  { id: "claude-code", title: "Claude Code" },
  { id: "codex", title: "Codex" },
] as const;

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

const thresholdsSchema = z.object({ yellow: z.number(), red: z.number() });

export const rpcContract = defineRpcContract({
  getState: {
    input: z.null(),
    output: z.object({
      openOnHover: z.boolean(),
      coloring: z.object({ mode: z.enum(["usage", "pace"]), usage: thresholdsSchema, pace: thresholdsSchema }),
      providers: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          logoUrl: z.string(),
          tint: z.object({ light: z.string(), dark: z.string() }).nullable(),
          toggles: z.object({ session: z.boolean(), weekly: z.boolean(), fable: z.boolean().optional() }),
          usage: usageResultSchema,
        }),
      ),
    }),
  },
});

const THRESHOLD_UNITS =
  "Share of limit used: percent of the limit burned. Usage ahead of time: percent by which usage runs ahead of the time elapsed in the window.";

interface ProviderBrand {
  logoUrl: string;
  tint: ProviderTint | null;
}

/** Logo and tint per provider id; a failed roster read leaves every provider on the plain logo path. */
async function readBrands(bb: BbPluginApi): Promise<Map<string, ProviderBrand>> {
  try {
    const roster = await bb.sdk.providers.list();
    return new Map(
      roster.map((provider) => [
        provider.id,
        {
          logoUrl: provider.logoUrl || `/api/v1/system/providers/${provider.id}/logo`,
          tint: provider.strings?.iconTint ?? null,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    fiveHour: { type: "boolean", label: "Claude Code — 5-hour window ring", default: true },
    weekly: { type: "boolean", label: "Claude Code — weekly window ring", default: true },
    fable: { type: "boolean", label: "Claude Code — Fable weekly window ring", default: true },
    codexFiveHour: { type: "boolean", label: "Codex — 5-hour window ring", default: true },
    codexWeekly: { type: "boolean", label: "Codex — weekly window ring", default: true },
    openOnHover: { type: "boolean", label: "Show panel on hover", default: true },
    coloring: {
      type: "select",
      label: "Ring color",
      description:
        "Share of limit used: color by the percent of the limit burned. Usage ahead of time: color by how far usage runs ahead of the time elapsed in the window — 20% means the limit is burning 1.2× faster than time.",
      options: [...COLORING_OPTIONS],
      default: COLORING_OPTIONS[0],
    },
    usageYellowThreshold: {
      type: "number",
      label: "Share of limit used — yellow from, %",
      description: `Used when Ring color is "Share of limit used". ${THRESHOLD_UNITS}`,
      default: 60,
    },
    usageRedThreshold: {
      type: "number",
      label: "Share of limit used — red from, %",
      description: `Used when Ring color is "Share of limit used". ${THRESHOLD_UNITS}`,
      default: 90,
    },
    paceYellowThreshold: {
      type: "number",
      label: "Usage ahead of time — yellow from, %",
      description: `Used when Ring color is "Usage ahead of time". ${THRESHOLD_UNITS}`,
      default: 20,
    },
    paceRedThreshold: {
      type: "number",
      label: "Usage ahead of time — red from, %",
      description: `Used when Ring color is "Usage ahead of time". ${THRESHOLD_UNITS}`,
      default: 50,
    },
  });

  const usageLimitsCache = createUsageLimitsCache(() => bb.sdk.system.usageLimits(), USAGE_CACHE_TTL_MS);

  bb.rpc.register(rpcContract, {
    async getState(): Promise<StateWire> {
      const values = await settings.get();
      const [usage, brands] = await Promise.all([usageLimitsCache.get(), readBrands(bb)]);
      const toggles: Record<(typeof PROVIDERS)[number]["id"], ProviderStateWire["toggles"]> = {
        "claude-code": { session: values.fiveHour, weekly: values.weekly, fable: values.fable },
        codex: { session: values.codexFiveHour, weekly: values.codexWeekly },
      };
      return {
        openOnHover: values.openOnHover,
        coloring: parseColoring({
          mode: values.coloring,
          usageYellow: values.usageYellowThreshold,
          usageRed: values.usageRedThreshold,
          paceYellow: values.paceYellowThreshold,
          paceRed: values.paceRedThreshold,
        }),
        providers: PROVIDERS.map(({ id, title }) => ({
          id,
          title,
          logoUrl: brands.get(id)?.logoUrl ?? `/api/v1/system/providers/${id}/logo`,
          tint: brands.get(id)?.tint ?? null,
          toggles: toggles[id],
          usage: normalizeUsage(selectProvider(usage, id)),
        })),
      };
    },
  });
}
