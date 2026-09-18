import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Manifest = { name: string; bb: { name: string } };

const manifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(new URL(`${dir}/package.json`, import.meta.url), "utf8"));

// The host derives a plugin id from its package name and lays out every
// plugin's homepage sections in alphabetical id order.
const pluginId = (m: Manifest) => m.name.replace(/^bb-plugin-/, "").toLowerCase();

describe("plugin identity", () => {
  const own = manifest(".");

  it("is Threads Overview", () => {
    expect(own.name).toBe("bb-plugin-threads-overview");
    expect(own.bb.name).toBe("Threads Overview");
  });

  it("sits below Prompt Drafts on the home screen", () => {
    const drafts = pluginId(manifest("../bb-plugin-prompt-drafts"));
    expect([drafts, pluginId(own)].sort()).toEqual([drafts, pluginId(own)]);
  });
});
