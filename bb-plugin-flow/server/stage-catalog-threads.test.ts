// @vitest-environment node
// Треды провайдеров bb в каталоге исполнителей: на каждого провайдера, кроме Claude Code (BBPL-965).
import { describe, expect, it } from "vitest";

import { readStageCatalog, type CatalogSources } from "./stage-catalog";

const sources = (patch: Partial<CatalogSources> = {}): CatalogSources => ({
  projectIds: async () => [],
  skills: async () => [],
  listDir: async (dir) => {
    throw new Error(`ENOENT ${dir}`);
  },
  readFile: async (path) => {
    throw new Error(`ENOENT ${path}`);
  },
  home: "/home/owner",
  ...patch,
});

const threadIds = async (patch: Partial<CatalogSources>) => (await readStageCatalog(sources(patch))).executors.filter((e) => e.kind === "thread").map((e) => e.id);

describe("треды провайдеров в каталоге", () => {
  it("Codex и opencode — исполнители-треды, Claude Code — нет", async () => {
    const providers = async () => [
      { id: "claude-code", displayName: "Claude Code" },
      { id: "codex", displayName: "Codex" },
      { id: "opencode", displayName: "opencode" },
    ];
    expect(await threadIds({ providers })).toEqual(["thread:codex", "thread:opencode"]);
  });

  it("список провайдеров не прочитался или его нет — тредов нет, каталог цел", async () => {
    expect(await threadIds({ providers: async () => Promise.reject(new Error("offline")) })).toEqual([]);
    expect(await threadIds({})).toEqual([]);
  });
});
