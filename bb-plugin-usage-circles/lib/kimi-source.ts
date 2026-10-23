// The shell that owns every Kimi effect: where the installation lives, how
// its config.toml and credentials are read, when the token is refreshed, how
// the answer is written back, and the one GET against {base}/usages. All
// decisions live in the pure cores (lib/kimi-quota.ts, lib/kimi-oauth.ts) —
// this file only reads the world, calls them, and writes the result.
// Caching is the caller's: server.ts wraps the source in the same TTL cache
// the host's usage-limits call gets.
import os from "node:os";
import { join } from "node:path";
import * as fsp from "node:fs/promises";
import type { UsageResultWire } from "./usage-model";
import { mapKimiHttpError, parseKimiUsages } from "./kimi-quota";
import {
  isTokenFresh,
  mergeRefreshedCredentials,
  refreshRequestBody,
  selectCredentialsFile,
  type KimiCredentials,
} from "./kimi-oauth";

/** The quota endpoint answers fast or not at all; same timeout the CLI gives it. */
const USAGE_TIMEOUT_MS = 8_000;

const DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";

/** The fs the source reads and writes; fakes in tests, node:fs in the plugin. */
export interface KimiSourceFs {
  readFile(path: string): Promise<string>;
  readdir(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number }>;
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface KimiSourceDeps {
  /** The installation root; absent — $KIMI_CODE_HOME, then ~/.kimi-code. */
  home?: string;
  fs?: KimiSourceFs;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const defaultFs: KimiSourceFs = {
  readFile: (path) => fsp.readFile(path, "utf8"),
  readdir: (dir) => fsp.readdir(dir),
  stat: async (path) => ({ mtimeMs: (await fsp.stat(path)).mtimeMs }),
  writeFile: (path, content) => fsp.writeFile(path, content, "utf8"),
  rename: (from, to) => fsp.rename(from, to),
};

const stripTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

/** The managed provider's base url from config.toml — the /coding/v1 one, not the search or fetch services. */
function configBaseUrl(configText: string): string | undefined {
  return [...configText.matchAll(/base_url\s*=\s*"([^"]+)"/g)]
    .map((match) => match[1]!)
    .find((url) => stripTrailingSlashes(url).endsWith("/coding/v1"));
}

function configOauthHost(configText: string): string | undefined {
  return /oauth_host\s*=\s*"([^"]+)"/.exec(configText)?.[1];
}

interface Fetched {
  ok: boolean;
  status: number;
  body: unknown;
  message?: string;
}

/** One HTTP call with a timeout, its failure as a value. */
async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { ok: true, status: response.status, body: await response.json().catch(() => undefined) };
  } catch (error) {
    return { ok: false, status: 0, body: undefined, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function createKimiUsageSource(deps: KimiSourceDeps = {}): () => Promise<UsageResultWire> {
  const fs = deps.fs ?? defaultFs;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  async function refresh(credentials: KimiCredentials & { refresh_token: string }, credentialsPath: string, oauthHost: string): Promise<KimiCredentials | UsageResultWire> {
    const answer = await fetchJson(fetchImpl, `${oauthHost}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: refreshRequestBody(credentials.refresh_token),
    }, USAGE_TIMEOUT_MS);
    if (!answer.ok) return { status: "error", message: `Failed to refresh the Kimi token: ${answer.message}` };
    if (answer.status !== 200) {
      const errorCode = typeof answer.body === "object" && answer.body !== null ? (answer.body as Record<string, unknown>).error : undefined;
      if (answer.status === 401 || answer.status === 403 || errorCode === "invalid_grant") return { status: "unauthenticated" };
      return { status: "error", message: `Failed to refresh the Kimi token: HTTP ${answer.status}` };
    }
    const merged = mergeRefreshedCredentials(credentials, answer.body, now());
    if (merged === undefined) return { status: "error", message: "The Kimi token refresh answered without an access token" };
    // Write back through a rename so a reader never meets a half-written file;
    // a failed write still leaves the fresh token usable for this call.
    await fs.writeFile(`${credentialsPath}.tmp`, JSON.stringify(merged)).then(() => fs.rename(`${credentialsPath}.tmp`, credentialsPath)).catch(() => undefined);
    return merged;
  }

  async function fetchKimiUsage(): Promise<UsageResultWire> {
    const home = deps.home ?? process.env.KIMI_CODE_HOME ?? join(os.homedir(), ".kimi-code");
    const credentialsDir = join(home, "credentials");
    const [configText, names] = await Promise.all([
      fs.readFile(join(home, "config.toml")).catch(() => undefined),
      fs.readdir(credentialsDir).catch(() => undefined),
    ]);
    if (configText === undefined && names === undefined) return { status: "not_installed" };

    const withMtimes = names === undefined ? [] : await Promise.all(
      names.map(async (name) => ({ name, mtimeMs: await fs.stat(join(credentialsDir, name)).then((s) => s.mtimeMs).catch(() => 0) })),
    );
    const fileName = selectCredentialsFile(withMtimes);
    if (fileName === undefined) return { status: "unauthenticated" };

    const credentialsPath = join(credentialsDir, fileName);
    let credentials: KimiCredentials;
    try {
      credentials = JSON.parse(await fs.readFile(credentialsPath));
    } catch {
      return { status: "unauthenticated" };
    }
    if (typeof credentials.access_token !== "string" || credentials.access_token.length === 0) return { status: "unauthenticated" };

    const config = configText ?? "";
    const baseUrl = stripTrailingSlashes(process.env.KIMI_CODE_BASE_URL ?? configBaseUrl(config) ?? DEFAULT_BASE_URL);
    const oauthHost = stripTrailingSlashes(process.env.KIMI_CODE_OAUTH_HOST ?? configOauthHost(config) ?? DEFAULT_OAUTH_HOST);

    if (!isTokenFresh(credentials, now())) {
      const { refresh_token } = credentials;
      if (refresh_token === undefined) return { status: "expired" };
      const refreshed = await refresh({ ...credentials, refresh_token }, credentialsPath, oauthHost);
      if ("status" in refreshed) return refreshed;
      credentials = refreshed;
    }

    const answer = await fetchJson(fetchImpl, `${baseUrl}/usages`, {
      headers: { Authorization: `Bearer ${credentials.access_token}`, Accept: "application/json" },
    }, USAGE_TIMEOUT_MS);
    if (!answer.ok) return { status: "error", message: `Failed to fetch usage: ${answer.message}` };
    if (answer.status !== 200) return mapKimiHttpError(answer.status);
    return { status: "ok", windows: parseKimiUsages(answer.body) };
  }

  // The caller owns caching (server.ts wraps this in the same TTL cache the
  // host's usage-limits call gets): the source answers one fresh call at a time.
  return fetchKimiUsage;
}
