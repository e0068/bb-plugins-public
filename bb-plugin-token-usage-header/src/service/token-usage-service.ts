// Public surface of the service layer: what server.ts (H4) will register
// against. Wires the runner, cache, and thread resolver together; nothing
// downstream needs the individual pieces.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { cacheKeyForParams, createTokensCache } from "./cache";
import { createTokensRunner, type TokensRunnerOptions } from "./tokens-runner";
import { createThreadSessionResolver } from "./thread-session";
import type { TokensQueryParams, TokensRunResult } from "./types";

export interface TokenUsageServiceOptions extends TokensRunnerOptions {
  /** Cache TTL in ms; defaults to createTokensCache's own default (30s). */
  cacheTtlMs?: number;
}

export interface TokenUsageService {
  /** Runs (or serves from cache) the tools/tokens.py slice described by `params`. */
  query(params: TokensQueryParams): Promise<TokensRunResult>;
  /** Resolves a BB threadId to its Claude Code sessionId, or null. */
  resolveSessionId(threadId: string): Promise<string | null>;
  /** Drops the query cache and the thread->session cache. */
  clearCache(): void;
}

export function createTokenUsageService(bb: BbPluginApi, options: TokenUsageServiceOptions = {}): TokenUsageService {
  const runner = createTokensRunner(options);
  const cache = createTokensCache(options.cacheTtlMs);
  const threadResolver = createThreadSessionResolver(bb);

  return {
    query(params) {
      return cache.get(cacheKeyForParams(params), () => runner.run(params));
    },
    resolveSessionId(threadId) {
      return threadResolver.resolve(threadId);
    },
    clearCache() {
      cache.clear();
      threadResolver.clearCache();
    },
  };
}
