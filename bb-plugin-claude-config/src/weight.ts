// Estimating a file's "weight" in tokens and displaying it. A pure layer
// with no I/O: the server reads the content and calls estimateTokens, the
// UI prints formatWeight.

// A rough estimate: ~4 characters per token — a common heuristic for Latin
// text and markup. No need for an exact tokenizer here: this is a "how much
// context will the file eat" indicator, not a billing count.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// A compact label without the word "tokens": "~340", "~1.2k", "~12k".
export function formatWeight(tokens: number): string {
  if (tokens < 1000) return `~${tokens}`;
  const thousands = tokens / 1000;
  return `~${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}

// Row weights arrive separately from the area itself (BBPL-333): getConfig
// draws the rows with tokens/readmePath null, getWeights reads the per-row
// files afterwards. Keys: plugin key, skill origin+name, agent file path.
export type SkillOrigin = "personal" | "project";

export type RowWeights = {
  plugins: Record<string, { tokens: number | null; readmePath: string | null }>;
  skills: Record<string, number | null>;
  agents: Record<string, number | null>;
};

export const skillWeightKey = (origin: SkillOrigin, name: string): string =>
  `${origin}:${name}`;

type Weighable = {
  plugins: { key: string; tokens: number | null; readmePath: string | null }[];
  skills: { name: string; origin: SkillOrigin; tokens: number | null }[];
  agents: { path: string; tokens: number | null }[];
};

// A row the weights don't mention keeps what it had.
export function mergeWeights<C extends Weighable>(config: C, weights: RowWeights): C {
  return {
    ...config,
    plugins: config.plugins.map((plugin) => ({
      ...plugin,
      ...weights.plugins[plugin.key],
    })),
    skills: config.skills.map((skill) => {
      const key = skillWeightKey(skill.origin, skill.name);
      return key in weights.skills ? { ...skill, tokens: weights.skills[key] } : skill;
    }),
    agents: config.agents.map((agent) =>
      agent.path in weights.agents
        ? { ...agent, tokens: weights.agents[agent.path] }
        : agent,
    ),
  };
}
