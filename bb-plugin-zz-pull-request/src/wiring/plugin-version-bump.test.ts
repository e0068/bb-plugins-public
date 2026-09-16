import { describe, expect, it } from "vitest";
import {
  applyPluginVersionBumps,
  githubVersionBumpPorts,
  type VersionBumpPorts,
  type VersionBumpRefs,
} from "./plugin-version-bump";
import type { ChangedFile, GithubRequest, RepoRef } from "../core/github-requests";
import type { GithubResponse } from "./create-pr";

const REFS: VersionBumpRefs = { mergeBase: "mb-sha", baseTip: "main" };

const packageJson = (version: string, name = "bb-plugin-x") =>
  `{\n  "name": "${name}",\n  "version": "${version}",\n  "type": "module"\n}\n`;

const base64Of = (s: string) => Buffer.from(s, "utf8").toString("base64");

type Payload = { content: string; encoding: "utf-8" | "base64" };

/** `entries` keys are `"<ref>:<path>"`. Missing keys resolve to null (not found at that ref). */
function fakePorts(entries: Record<string, Payload>): {
  ports: VersionBumpPorts;
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    ports: {
      async readFileAt(ref, path) {
        reads.push(`${ref}:${path}`);
        return entries[`${ref}:${path}`] ?? null;
      },
    },
  };
}

/** The common case: the file at both the merge-base and the live tip agree on `payload`. */
function agreeing(path: string, payload: Payload): Record<string, Payload> {
  return { [`${REFS.mergeBase}:${path}`]: payload, [`${REFS.baseTip}:${path}`]: payload };
}

describe("applyPluginVersionBumps", () => {
  it("package.json already in the diff, base unchanged since merge-base → bumps the diff's own content, not the base's; also probes for a package-lock.json to bump alongside it", async () => {
    // The diff's content deliberately differs from what's at the refs (an
    // unrelated author edit, "scripts") — a version that only checks the
    // bumped *number* can't tell "bumped the author's content" apart from
    // "silently replaced it with the base's own copy". Both must show up.
    // No package-lock.json exists in this fixture, so both of its reads
    // resolve to null and it's left untouched — still part of `reads` since
    // the check runs unconditionally per root.
    const authorsEdit = packageJson("0.1.4").replace('"module"', '"module","scripts":{"test":"vitest"}');
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/server.ts", content: "x", encoding: "utf-8" },
      { kind: "upsert", path: "bb-plugin-a/package.json", content: authorsEdit, encoding: "utf-8" },
    ];
    const { ports, reads } = fakePorts(
      agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
    );

    const result = await applyPluginVersionBumps(
      ports,
      REFS,
      ["bb-plugin-a/server.ts", "bb-plugin-a/package.json"],
      files,
    );

    expect(reads.sort()).toEqual(
      [
        "mb-sha:bb-plugin-a/package.json",
        "main:bb-plugin-a/package.json",
        "mb-sha:bb-plugin-a/package-lock.json",
        "main:bb-plugin-a/package-lock.json",
      ].sort(),
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      kind: "upsert",
      path: "bb-plugin-a/package.json",
      content: authorsEdit.replace('"0.1.4"', '"0.1.5"'),
      encoding: "utf-8",
    });
  });

  it("the author already bumped \"version\" themselves → their value is what gets bumped, not the base's", async () => {
    // Author's own edit: 0.1.4 → 0.1.5. The base hasn't moved this file
    // since the merge-base, so the gate passes and the diff's own content
    // (already at 0.1.5) wins over the base's (still 0.1.4) — the result is
    // 0.1.6, not a re-bump of the base's stale 0.1.4 → 0.1.5.
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/package.json", content: packageJson("0.1.5"), encoding: "utf-8" },
    ];
    const { ports } = fakePorts(
      agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/package.json"], files);

    expect(result).toEqual([
      { kind: "upsert", path: "bb-plugin-a/package.json", content: packageJson("0.1.6"), encoding: "utf-8" },
    ]);
  });

  it("package.json already in the diff, but the base drifted since merge-base → the diff's own content is kept, untouched", async () => {
    // The regression this closes: the diff's own edit to the file (say
    // scripts.test) never touched "version" — but injecting a bump anyway
    // would still collide with the base's own edit to that line, since the
    // PR's commit is parented on the merge-base either way.
    const authorsEdit = packageJson("0.1.4").replace('"module"', '"module","scripts":{"test":"vitest"}');
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/package.json", content: authorsEdit, encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      "mb-sha:bb-plugin-a/package.json": { content: packageJson("0.1.4"), encoding: "utf-8" },
      "main:bb-plugin-a/package.json": { content: packageJson("0.1.6"), encoding: "utf-8" },
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/package.json"], files);

    expect(result).toEqual(files);
  });

  it("a plugin touched without its package.json in the diff, base unchanged since merge-base → reads both refs and appends a bump", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-b/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports, reads } = fakePorts(
      agreeing("bb-plugin-b/package.json", { content: packageJson("0.2.0"), encoding: "utf-8" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-b/app.tsx"], files);

    expect(reads.sort()).toEqual(
      [
        "mb-sha:bb-plugin-b/package.json",
        "main:bb-plugin-b/package.json",
        "mb-sha:bb-plugin-b/package-lock.json",
        "main:bb-plugin-b/package-lock.json",
      ].sort(),
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      kind: "upsert",
      path: "bb-plugin-b/package.json",
      content: packageJson("0.2.1"),
      encoding: "utf-8",
    });
  });

  it("the base moved the package.json since the merge-base → refuses (would manufacture a conflict)", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-g/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      "mb-sha:bb-plugin-g/package.json": { content: packageJson("0.1.4"), encoding: "utf-8" },
      "main:bb-plugin-g/package.json": { content: packageJson("0.1.5"), encoding: "utf-8" },
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-g/app.tsx"], files);

    expect(result).toEqual(files);
  });

  it("a root with no package.json at either ref (e.g. packages/plugin-base) → left untouched", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "packages/plugin-base/tsconfig.json", content: "{}", encoding: "utf-8" },
    ];
    const { ports } = fakePorts({});

    const result = await applyPluginVersionBumps(
      ports,
      REFS,
      ["packages/plugin-base/tsconfig.json"],
      files,
    );

    expect(result).toEqual(files);
  });

  it("the plugin's package.json was deleted in this diff → not resurrected", async () => {
    const files: ChangedFile[] = [{ kind: "delete", path: "bb-plugin-c/package.json" }];
    const { ports, reads } = fakePorts({});

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-c/package.json"], files);

    expect(reads).toEqual([]);
    expect(result).toEqual(files);
  });

  it("a root whose package.json exists at neither ref (e.g. a brand-new plugin, added by this very diff) → untouched", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-d/package.json", content: '{ "name": "x" }', encoding: "utf-8" },
    ];
    const { ports } = fakePorts({});

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-d/package.json"], files);

    expect(result).toEqual(files);
  });

  it("the refs agree, but the version isn't a parseable plain semver → the gate passes yet bumpChangedFileVersion still refuses, left untouched", async () => {
    const unbumpable = { content: '{ "name": "x", "version": "1.0.0-rc.1" }', encoding: "utf-8" as const };
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-h/package.json", content: unbumpable.content, encoding: "utf-8" },
    ];
    const { ports } = fakePorts(agreeing("bb-plugin-h/package.json", unbumpable));

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-h/package.json"], files);

    expect(result).toEqual(files);
  });

  it("bumps every plugin touched by a multi-plugin diff", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/package.json", content: packageJson("0.1.4"), encoding: "utf-8" },
      { kind: "upsert", path: "bb-plugin-b/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      ...agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
      ...agreeing("bb-plugin-b/package.json", { content: packageJson("0.2.0"), encoding: "utf-8" }),
    });

    const result = await applyPluginVersionBumps(
      ports,
      REFS,
      ["bb-plugin-a/package.json", "bb-plugin-b/app.tsx"],
      files,
    );

    const versionOf = (path: string) => {
      const entry = result.find((f) => f.path === path);
      return entry?.kind === "upsert" ? entry.content : null;
    };
    expect(versionOf("bb-plugin-a/package.json")).toBe(packageJson("0.1.5"));
    expect(versionOf("bb-plugin-b/package.json")).toBe(packageJson("0.2.1"));
  });

  it("round-trips base64-encoded content already in the diff", async () => {
    const files: ChangedFile[] = [
      {
        kind: "upsert",
        path: "bb-plugin-e/package.json",
        content: base64Of(packageJson("1.0.0")),
        encoding: "base64",
      },
    ];
    const { ports } = fakePorts(
      agreeing("bb-plugin-e/package.json", { content: base64Of(packageJson("1.0.0")), encoding: "base64" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-e/package.json"], files);

    expect(result[0]).toEqual({
      kind: "upsert",
      path: "bb-plugin-e/package.json",
      content: base64Of(packageJson("1.0.1")),
      encoding: "base64",
    });
  });

  it("no plugin/package files touched → the file list passes through unchanged", async () => {
    const files: ChangedFile[] = [{ kind: "upsert", path: "README.md", content: "x", encoding: "utf-8" }];
    const { ports } = fakePorts({});

    const result = await applyPluginVersionBumps(ports, REFS, ["README.md"], files);

    expect(result).toEqual(files);
  });

  it("reads base64-encoded content through the port and bumps it correctly", async () => {
    const { ports } = fakePorts(
      agreeing("bb-plugin-f/package.json", { content: base64Of(packageJson("3.0.0")), encoding: "base64" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-f/app.tsx"], []);

    expect(result).toEqual([
      {
        kind: "upsert",
        path: "bb-plugin-f/package.json",
        content: base64Of(packageJson("3.0.1")),
        encoding: "base64",
      },
    ]);
  });

  it("GitHub's line-wrapped base64 (a newline every ~60 chars) still decodes, bumps, and re-encodes correctly", async () => {
    const wrapped = (s: string) => base64Of(s).replace(/.{1,60}/g, "$&\n");
    const { ports } = fakePorts(
      agreeing("bb-plugin-w/package.json", { content: wrapped(packageJson("0.9.9")), encoding: "base64" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-w/app.tsx"], []);

    expect(result).toHaveLength(1);
    const bumped = result[0];
    expect(bumped.kind).toBe("upsert");
    expect(Buffer.from((bumped as { content: string }).content, "base64").toString("utf8")).toBe(
      packageJson("0.9.10"),
    );
  });

  it("a package-lock.json exists and is safe to bump → set to the same version package.json just landed on", async () => {
    const lock = (version: string) =>
      `${JSON.stringify({ name: "bb-plugin-a", version, lockfileVersion: 3, packages: { "": { version } } }, null, 2)}\n`;
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      ...agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
      ...agreeing("bb-plugin-a/package-lock.json", { content: lock("0.1.4"), encoding: "utf-8" }),
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/app.tsx"], files);

    const lockEntry = result.find((f) => f.path === "bb-plugin-a/package-lock.json");
    expect(lockEntry?.kind).toBe("upsert");
    const parsed = JSON.parse((lockEntry as { content: string }).content);
    expect(parsed.version).toBe("0.1.5");
    expect(parsed.packages[""].version).toBe("0.1.5");
  });

  it("the package-lock.json already drifted from package.json at the live tip (the real-world bug) → still lands on package.json's fresh target, not its own value + 1", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      ...agreeing("bb-plugin-a/package.json", { content: packageJson("0.3.1"), encoding: "utf-8" }),
      ...agreeing("bb-plugin-a/package-lock.json", {
        content: `${JSON.stringify({ name: "bb-plugin-a", version: "0.3.0", packages: { "": { version: "0.3.0" } } })}\n`,
        encoding: "utf-8",
      }),
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/app.tsx"], files);

    const lockEntry = result.find((f) => f.path === "bb-plugin-a/package-lock.json");
    expect(JSON.parse((lockEntry as { content: string }).content).version).toBe("0.3.2");
  });

  it("the base moved the package-lock.json since the merge-base → left alone even though package.json bumped fine", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      ...agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
      "mb-sha:bb-plugin-a/package-lock.json": { content: '{"name":"a","version":"0.1.3"}', encoding: "utf-8" },
      "main:bb-plugin-a/package-lock.json": { content: '{"name":"a","version":"0.1.4"}', encoding: "utf-8" },
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/app.tsx"], files);

    expect(result.some((f) => f.path === "bb-plugin-a/package-lock.json")).toBe(false);
  });

  it("no package-lock.json at either ref → package.json still bumps, nothing added for the lockfile", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports } = fakePorts(
      agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/app.tsx"], files);

    expect(result).toEqual([
      files[0],
      { kind: "upsert", path: "bb-plugin-a/package.json", content: packageJson("0.1.5"), encoding: "utf-8" },
    ]);
  });

  it("the package.json bump itself is skipped (base drifted) → the lockfile isn't even probed", async () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/app.tsx", content: "x", encoding: "utf-8" },
    ];
    const { ports, reads } = fakePorts({
      "mb-sha:bb-plugin-a/package.json": { content: packageJson("0.1.4"), encoding: "utf-8" },
      "main:bb-plugin-a/package.json": { content: packageJson("0.1.5"), encoding: "utf-8" },
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/app.tsx"], files);

    expect(reads).toEqual(["mb-sha:bb-plugin-a/package.json", "main:bb-plugin-a/package.json"]);
    expect(result).toEqual(files);
  });

  it("the diff already carries a package-lock.json edit → that content is the base for the bump, not the refs' copy", async () => {
    const baseLock = `${JSON.stringify({ name: "bb-plugin-a", version: "0.1.4", packages: { "": { version: "0.1.4" } } })}\n`;
    const authorsLock = `${JSON.stringify({ name: "bb-plugin-a", version: "0.1.4", packages: { "": { version: "0.1.4" }, "node_modules/x": { version: "2.0.0" } } })}\n`;
    const files: ChangedFile[] = [
      { kind: "upsert", path: "bb-plugin-a/package-lock.json", content: authorsLock, encoding: "utf-8" },
    ];
    const { ports } = fakePorts({
      ...agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
      ...agreeing("bb-plugin-a/package-lock.json", { content: baseLock, encoding: "utf-8" }),
    });

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/package-lock.json"], files);

    const lockEntry = result.find((f) => f.path === "bb-plugin-a/package-lock.json");
    const parsed = JSON.parse((lockEntry as { content: string }).content);
    expect(parsed.version).toBe("0.1.5");
    expect(parsed.packages["node_modules/x"].version).toBe("2.0.0");
  });

  it("never mutates the input files array or its entries", async () => {
    const files: ChangedFile[] = [
      Object.freeze({ kind: "upsert", path: "bb-plugin-a/package.json", content: packageJson("0.1.4"), encoding: "utf-8" }),
    ];
    Object.freeze(files);
    const { ports } = fakePorts(
      agreeing("bb-plugin-a/package.json", { content: packageJson("0.1.4"), encoding: "utf-8" }),
    );

    const result = await applyPluginVersionBumps(ports, REFS, ["bb-plugin-a/package.json"], files);

    expect(files[0]).toEqual({
      kind: "upsert",
      path: "bb-plugin-a/package.json",
      content: packageJson("0.1.4"),
      encoding: "utf-8",
    });
    expect(result).not.toBe(files);
    expect(result[0]).not.toBe(files[0]);
  });
});

describe("githubVersionBumpPorts", () => {
  const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

  function fakeSend(reply: (req: GithubRequest) => GithubResponse) {
    const calls: GithubRequest[] = [];
    return { calls, send: async (req: GithubRequest) => (calls.push(req), reply(req)) };
  }

  it("200 with base64 content → the payload", async () => {
    const { send } = fakeSend(() => ({
      status: 200,
      data: { type: "file", content: "aGVsbG8=", encoding: "base64" },
    }));

    const result = await githubVersionBumpPorts(send, repo).readFileAt("main", "bb-plugin-x/package.json");

    expect(result).toEqual({ content: "aGVsbG8=", encoding: "base64" });
  });

  it("uses the Contents API at the given ref and path", async () => {
    const { send, calls } = fakeSend(() => ({ status: 404, data: {} }));

    await githubVersionBumpPorts(send, repo).readFileAt("mb-sha", "bb-plugin-x/package.json");

    expect(calls).toEqual([
      {
        method: "GET",
        path: "/repos/e0068/bb-plugins/contents/bb-plugin-x/package.json?ref=mb-sha",
      },
    ]);
  });

  it("404 → null (no file at that ref)", async () => {
    const { send } = fakeSend(() => ({ status: 404, data: { message: "Not Found" } }));

    const result = await githubVersionBumpPorts(send, repo).readFileAt("main", "packages/plugin-base/package.json");

    expect(result).toBeNull();
  });

  it("a genuinely empty base64 file (content: \"\", encoding: base64) is a payload, not \"not found\"", async () => {
    // A truthy check on `content` would mistake this for a 404 — the fix
    // this test pins down distinguishes "no content field" (null) from "an
    // empty but present one" (the empty string itself).
    const { send } = fakeSend(() => ({
      status: 200,
      data: { type: "file", content: "", encoding: "base64" },
    }));

    const result = await githubVersionBumpPorts(send, repo).readFileAt("main", "bb-plugin-x/package.json");

    expect(result).toEqual({ content: "", encoding: "base64" });
  });

  it("a file over 1 MB (encoding: none) → null, not an empty-string bump target", async () => {
    const { send } = fakeSend(() => ({
      status: 200,
      data: { type: "file", content: "", encoding: "none" },
    }));

    const result = await githubVersionBumpPorts(send, repo).readFileAt("main", "bb-plugin-x/package.json");

    expect(result).toBeNull();
  });

  it("a non-2xx, non-404 status (auth, rate limit, server error) throws instead of silently skipping", async () => {
    const { send } = fakeSend(() => ({ status: 500, data: { message: "boom" } }));

    await expect(
      githubVersionBumpPorts(send, repo).readFileAt("main", "bb-plugin-x/package.json"),
    ).rejects.toThrow(/HTTP 500/);
  });
});
