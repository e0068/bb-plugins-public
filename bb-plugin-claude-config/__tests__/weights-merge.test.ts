import { describe, expect, it } from "vitest";
import { mergeWeights, skillWeightKey, type RowWeights } from "../src/weight";

// getConfig draws the area without row weights (tokens null, readmePath
// null); getWeights brings them a moment later and the panel folds them in
// with mergeWeights. BBPL-333.

const config = {
  areaLabel: "Globally",
  plugins: [
    { key: "a@m", name: "a", tokens: null, readmePath: null },
    { key: "b@m", name: "b", tokens: null, readmePath: null },
  ],
  skills: [
    { name: "x", origin: "personal" as const, tokens: null },
    { name: "x", origin: "project" as const, tokens: null },
  ],
  agents: [{ name: "r", origin: "personal" as const, path: "/a/r.md", tokens: null }],
  connectors: [{ name: "c", tokens: 7 }],
};

const empty: RowWeights = { plugins: {}, skills: {}, agents: {} };

describe("mergeWeights", () => {
  it("fills tokens and readmePath of the rows it has weights for", () => {
    const merged = mergeWeights(config, {
      plugins: { "a@m": { tokens: 120, readmePath: "/p/a/README.md" } },
      skills: { [skillWeightKey("project", "x")]: 40 },
      agents: { "/a/r.md": 9 },
    });
    expect(merged.plugins).toEqual([
      { key: "a@m", name: "a", tokens: 120, readmePath: "/p/a/README.md" },
      { key: "b@m", name: "b", tokens: null, readmePath: null },
    ]);
    expect(merged.skills).toEqual([
      { name: "x", origin: "personal", tokens: null },
      { name: "x", origin: "project", tokens: 40 },
    ]);
    expect(merged.agents).toEqual([
      { name: "r", origin: "personal", path: "/a/r.md", tokens: 9 },
    ]);
  });

  it("empty weights change nothing, other fields pass through", () => {
    expect(mergeWeights(config, empty)).toEqual(config);
  });

  it("does not mutate the config it was given", () => {
    const before = structuredClone(config);
    mergeWeights(config, {
      plugins: { "b@m": { tokens: 1, readmePath: null } },
      skills: { [skillWeightKey("personal", "x")]: 2 },
      agents: { "/a/r.md": 3 },
    });
    expect(config).toEqual(before);
  });

  it("personal and project skills of one name are different keys", () => {
    expect(skillWeightKey("personal", "x")).not.toBe(skillWeightKey("project", "x"));
  });
});
