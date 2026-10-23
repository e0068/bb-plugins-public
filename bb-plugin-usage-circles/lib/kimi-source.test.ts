// Promises of lib/kimi-source.ts, the shell that owns every Kimi effect:
// reading config.toml and the credentials directory, refreshing the token,
// asking {base}/usages and caching the answer. fs and fetch are fakes here —
// the logic is in the seam, not in node.
import { describe, expect, it } from "vitest";
import { createKimiUsageSource, type KimiSourceDeps } from "./kimi-source";

interface FakeFile {
  content: string;
  mtimeMs: number;
}

/** An in-memory fs: paths to files, plus a record of every write. */
function fakeFs(files: Record<string, FakeFile>) {
  const writes: Record<string, string> = {};
  const fs: KimiSourceDeps["fs"] = {
    readFile: async (path) => {
      const file = files[path];
      if (!file) throw new Error(`ENOENT: ${path}`);
      return file.content;
    },
    readdir: async (dir) => {
      const prefix = `${dir}/`;
      const names = Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length))
        .filter((name) => !name.includes("/"));
      if (names.length === 0) throw new Error(`ENOENT: ${dir}`);
      return names;
    },
    stat: async (path) => {
      const file = files[path];
      if (!file) throw new Error(`ENOENT: ${path}`);
      return { mtimeMs: file.mtimeMs };
    },
    writeFile: async (path, content) => {
      writes[path] = content;
      files[path] = { content, mtimeMs: NOW };
    },
    rename: async (from, to) => {
      const file = files[from];
      if (!file) throw new Error(`ENOENT: ${from}`);
      files[to] = file;
      delete files[from];
      writes[to] = file.content;
    },
  };
  return { fs, writes };
}

const NOW = 1_800_000_000_000;

const CONFIG = `oauth_host = "https://auth.kimi.ai"\nbase_url = "https://api.kimi.ai/coding/v1"\n`;
const CREDS = JSON.stringify({
  access_token: "at-live",
  refresh_token: "rt-live",
  expires_at: NOW + 3_600_000,
  token_type: "Bearer",
});

function install(overrides: { files?: Record<string, FakeFile>; fetchImpl?: KimiSourceDeps["fetchImpl"] } = {}) {
  const files = overrides.files ?? {
    "/kimi/config.toml": { content: CONFIG, mtimeMs: NOW },
    "/kimi/credentials/kimi-code-env-aaa.json": { content: CREDS, mtimeMs: NOW },
  };
  const { fs, writes } = fakeFs(files);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: KimiSourceDeps["fetchImpl"] =
    overrides.fetchImpl ??
    (async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ usages: { limit_5h: { used_ratio: 0.39, reset_time: "2026-10-22T15:37:38Z" } } }),
        { status: 200 },
      );
    });
  const deps: KimiSourceDeps = { home: "/kimi", fs, fetchImpl, now: () => NOW };
  return { getUsage: createKimiUsageSource(deps), calls, writes, files };
}

describe("createKimiUsageSource", () => {
  it("answers the quota of the stored token, against the base url of the installation's config", async () => {
    const { getUsage, calls } = install();
    const usage = await getUsage();
    expect(usage).toEqual({
      status: "ok",
      windows: [{ label: "Current session", usedPercent: 39, resetsAt: "2026-10-22T15:37:38Z" }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.kimi.ai/coding/v1/usages");
    expect(new Headers(calls[0]!.init?.headers).get("Authorization")).toBe("Bearer at-live");
  });

  it("answers not_installed when the installation is not there", async () => {
    const { getUsage } = install({ files: {} });
    expect(await getUsage()).toEqual({ status: "not_installed" });
  });

  it("answers unauthenticated when no credentials file is stored", async () => {
    const { getUsage } = install({ files: { "/kimi/config.toml": { content: CONFIG, mtimeMs: NOW } } });
    expect(await getUsage()).toEqual({ status: "unauthenticated" });
  });

  it("refreshes a stale token, stores the merged credentials and asks with the new token", async () => {
    const stale = JSON.stringify({ access_token: "at-old", refresh_token: "rt-live", expires_at: NOW - 1000 });
    const { getUsage, calls, writes } = install({
      files: {
        "/kimi/config.toml": { content: CONFIG, mtimeMs: NOW },
        "/kimi/credentials/kimi-code-env-aaa.json": { content: stale, mtimeMs: NOW },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://auth.kimi.ai/api/oauth/token") {
          return new Response(JSON.stringify({ access_token: "at-new", expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0.5 } } }), { status: 200 });
      },
    });
    const usage = await getUsage();
    expect(usage.status).toBe("ok");
    expect(calls.map((call) => call.url)).toEqual(["https://auth.kimi.ai/api/oauth/token", "https://api.kimi.ai/coding/v1/usages"]);
    expect(new Headers(calls[1]!.init?.headers).get("Authorization")).toBe("Bearer at-new");
    const stored = JSON.parse(writes["/kimi/credentials/kimi-code-env-aaa.json"]!);
    expect(stored.access_token).toBe("at-new");
    expect(stored.refresh_token).toBe("rt-live");
  });

  it("answers expired when the token is stale and no refresh token is stored", async () => {
    const stale = JSON.stringify({ access_token: "at-old", expires_at: NOW - 1000 });
    const { getUsage } = install({
      files: { "/kimi/credentials/kimi-code-env-aaa.json": { content: stale, mtimeMs: NOW } },
    });
    expect(await getUsage()).toEqual({ status: "expired" });
  });

  it("answers unauthenticated when the refresh is refused", async () => {
    const stale = JSON.stringify({ access_token: "at-old", refresh_token: "rt-dead", expires_at: NOW - 1000 });
    const { getUsage } = install({
      files: { "/kimi/credentials/kimi-code-env-aaa.json": { content: stale, mtimeMs: NOW } },
      fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }),
    });
    expect(await getUsage()).toEqual({ status: "unauthenticated" });
  });

  it("maps the usage endpoint's HTTP answer through the quota rules", async () => {
    const { getUsage } = install({ fetchImpl: async () => new Response("not found", { status: 404 }) });
    expect(await getUsage()).toEqual({ status: "error", message: "No Kimi For Coding plan on this account" });
  });

  it("answers error when the network fails", async () => {
    const { getUsage } = install({
      fetchImpl: async () => {
        throw new Error("socket hang up");
      },
    });
    const usage = await getUsage();
    expect(usage.status).toBe("error");
    expect(usage.status === "error" && usage.message).toContain("socket hang up");
  });
});
