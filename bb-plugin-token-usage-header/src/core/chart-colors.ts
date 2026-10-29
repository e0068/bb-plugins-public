// Which colour an agent's columns get on the charts: the chart colour scheme
// the owner picked, the one table from model to colour, and the rule that
// ties them. Pure — the host theme and the stored values come in as arguments.

/** How the charts colour agents: from the palette, from the model the agent ran on, or as a ramp between two colours (packages/reduced-colors). */
export const CHART_COLOR_SCHEMES = ["palette", "model", "reduced"] as const;

export type ChartColorScheme = (typeof CHART_COLOR_SCHEMES)[number];

/** The plugin kv key the chosen scheme is stored under. */
export const CHART_COLOR_SCHEME_KV_KEY = "chart-color-scheme";

/** The host theme a chart is drawn in — the same two values bb's own theme switch has. */
export type ChartTheme = "light" | "dark";

/** The Claude families the model scheme tells apart, in the order of the table below. */
export type ModelFamily = "fable" | "opus" | "sonnet" | "haiku";

/** The one table: a family's colour in each theme. Fable is white, which vanishes on a light card, so there it is light grey. */
const MODEL_COLORS: Readonly<Record<ModelFamily, Readonly<Record<ChartTheme, string>>>> = {
  fable: { dark: "#ffffff", light: "#d4d4d8" },
  opus: { dark: "#facc15", light: "#facc15" },
  sonnet: { dark: "#f97316", light: "#f97316" },
  haiku: { dark: "#c2410c", light: "#c2410c" },
};

const FAMILIES = Object.keys(MODEL_COLORS) as readonly ModelFamily[];

/** A stored value → the scheme; nothing readable stored means the owner never chose, so Reduced Colors keeps its old on/off meaning. */
export function parseChartColorScheme(raw: unknown, reducedColorsWasOn: boolean): ChartColorScheme {
  const stored = CHART_COLOR_SCHEMES.find((scheme) => scheme === raw);
  return stored ?? (reducedColorsWasOn ? "reduced" : "palette");
}

/** The Claude family of an exact model id, read like tools/tokens.py's tier(); another provider's model has none. */
export function modelFamily(model: string | null | undefined): ModelFamily | undefined {
  const id = (model ?? "").toLowerCase();
  return id.startsWith("claude-") ? FAMILIES.find((family) => id.includes(family)) : undefined;
}

export function modelColor(model: string | null | undefined, theme: ChartTheme): string | undefined {
  const family = modelFamily(model);
  return family === undefined ? undefined : MODEL_COLORS[family][theme];
}

export interface AgentColorInput {
  readonly scheme: ChartColorScheme;
  readonly theme: ChartTheme;
  /** The exact model id the agent spent most tokens on, when the report names one. */
  readonly model: string | null | undefined;
  /** A colour the owner picked for this agent in the legend. */
  readonly manual: string | undefined;
  /** What the chart paints the agent with when the model scheme has nothing to say — the palette slot, or the ramp step under Reduced Colors. */
  readonly fallback: string;
}

/** Under the model scheme: the owner's own pick, else the model's colour, else the fallback. Under the other two schemes the fallback already is the answer. */
export function agentColor({ scheme, theme, model, manual, fallback }: AgentColorInput): string {
  return scheme === "model" ? (manual ?? modelColor(model, theme) ?? fallback) : fallback;
}
