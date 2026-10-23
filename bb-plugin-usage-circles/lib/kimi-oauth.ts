// Layer 1 — pure logic. Decisions about a Kimi Code installation's OAuth
// credentials: which file is the live one, whether its access token still
// counts as fresh, what the refresh request carries, and how a refresh
// response merges into the stored record. No fs, no fetch — the shell in
// lib/kimi-source.ts feeds the world in through the arguments.

/** The OAuth client id of the Kimi Code device flow, shared by every installation. */
export const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";

/** A token this close to expiry is treated as already stale, so a request never leaves with a token that dies in flight. */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** The credentials record of one Kimi Code environment, as ~/.kimi-code/credentials stores it. */
export interface KimiCredentials {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds; absent on older records — such a token is tried as-is. */
  expires_at?: number;
  scope?: string;
  token_type?: string;
  expires_in?: number;
}

export function isTokenFresh(credentials: Pick<KimiCredentials, "expires_at">, nowMs: number): boolean {
  return credentials.expires_at === undefined || credentials.expires_at - nowMs > TOKEN_EXPIRY_SKEW_MS;
}

/** The live credentials file of an installation: the most recently written kimi-code-env-*.json (one per region a machine signed in to). */
export function selectCredentialsFile(files: readonly { name: string; mtimeMs: number }[]): string | undefined {
  return files
    .filter((file) => /^kimi-code-env-[^/]+\.json$/.test(file.name))
    .reduce<(typeof files)[number] | undefined>((best, file) => (best === undefined || file.mtimeMs > best.mtimeMs ? file : best), undefined)
    ?.name;
}

/** The form body of the refresh_token grant against {oauthHost}/api/oauth/token. */
export function refreshRequestBody(refreshToken: string): string {
  return new URLSearchParams({
    client_id: KIMI_CODE_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();
}

/**
 * The stored credentials after a refresh: the response's access token, its
 * expiry as epoch milliseconds (expires_in is seconds from now), and the
 * rotated refresh token — or the old one when the response brings none.
 * A response without an access token is not a refresh.
 */
export function mergeRefreshedCredentials(
  old: KimiCredentials,
  response: unknown,
  nowMs: number,
): KimiCredentials | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const accessToken = (response as Record<string, unknown>).access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return undefined;
  const record = response as Record<string, unknown>;
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : undefined;
  const refreshToken = record.refresh_token;
  return {
    ...old,
    access_token: accessToken,
    refresh_token: typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : old.refresh_token,
    expires_at: expiresIn !== undefined ? nowMs + expiresIn * 1000 : old.expires_at,
  };
}
