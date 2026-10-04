// bb-plugin-usage-circles — backend entry. Reads Claude Code's and Codex's
// usage limits through the BB SDK (bb.sdk.system.usageLimits), their logos and
// brand tints from the host's provider list, and exposes them — plus the
// coloring settings and the ring style — over getState. The ring's dimensions,
// tuned in the plugin's settings section, are kept in the plugin's KV store.
// No parsing of provider files — see docs/decisions/usage-rings-own-code.md.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  COLORING_OPTIONS,
  normalizeUsage,
  parseColoring,
  selectProvider,
  type ProviderTint,
  type StateWire,
} from "./lib/usage-model";
import { createUsageLimitsCache } from "./lib/usage-cache";
import { DEFAULT_RING_DIMS, LOGO_OPTIONS, logoPlacementOf, parseRingDims, type RingDims } from "./lib/ring-style";

/** KV key of the tuned ring dimensions; absent — the defaults. */
const RING_DIMS_KEY = "ring-dims";

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

const ringDimsSchema = z.object({
  size: z.number(),
  outer: z.number(),
  inner: z.number(),
  gap: z.number(),
  segmentGap: z.number(),
  track: z.number(),
  centerLogo: z.number(),
  cornerLogo: z.number(),
  cornerPad: z.number(),
  cornerTop: z.number(),
  cornerRight: z.number(),
}) satisfies z.ZodType<RingDims>;

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
          usage: usageResultSchema,
        }),
      ),
      ring: z.object({ logo: z.enum(["center", "corner"]), dims: ringDimsSchema }),
    }),
  },
  /**
   * Merge tuned dimensions into the stored ones — only the slider that moved,
   * so a window holding an older look never overwrites another one's tuning.
   * Each value is pulled into its slider's range. Returns the whole record.
   */
  setRingDims: { input: ringDimsSchema.partial(), output: ringDimsSchema },
  /** Forget tuned dimensions. Returns the defaults. */
  resetRingDims: { input: z.null(), output: ringDimsSchema },
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
    logo: {
      type: "select",
      label: "Provider logo",
      description: "Where each ring shows its provider's logo. The ring's sizes are tuned under Ring below.",
      options: [...LOGO_OPTIONS],
      default: LOGO_OPTIONS[0],
    },
  });
  const readRingDims = async (): Promise<RingDims> => parseRingDims(await bb.storage.kv.get(RING_DIMS_KEY));

  const usageLimitsCache = createUsageLimitsCache(() => bb.sdk.system.usageLimits(), USAGE_CACHE_TTL_MS);

  bb.rpc.register(rpcContract, {
    async getState(): Promise<StateWire> {
      const values = await settings.get();
      const [usage, brands, dims] = await Promise.all([usageLimitsCache.get(), readBrands(bb), readRingDims()]);
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
          usage: normalizeUsage(selectProvider(usage, id)),
        })),
        ring: { logo: logoPlacementOf(values.logo), dims },
      };
    },
    async setRingDims(patch): Promise<RingDims> {
      const dims = parseRingDims({ ...(await readRingDims()), ...patch });
      await bb.storage.kv.set(RING_DIMS_KEY, dims);
      return dims;
    },
    async resetRingDims(): Promise<RingDims> {
      await bb.storage.kv.delete(RING_DIMS_KEY);
      return DEFAULT_RING_DIMS;
    },
  });
}
