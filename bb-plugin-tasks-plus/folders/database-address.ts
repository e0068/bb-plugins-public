/**
 * The address typed into "Connect database", parsed once at the door.
 * Pure: no network, no settings.
 */

export type ParsedDatabaseAddress = { ok: true; url: string; token: string | null } | { ok: false; message: string };

const ACCEPTED_SCHEMES: readonly string[] = ["libsql:", "https:"];
const TOKEN_PARAM = "authToken";

const refuse = (message: string): ParsedDatabaseAddress => ({ ok: false, message });

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** `libsql://` and `https://` addresses; `?authToken=` becomes the token and leaves the address. */
export function parseDatabaseAddress(raw: string): ParsedDatabaseAddress {
  const text = raw.trim();
  if (text === "") return refuse("Enter the address of the database.");
  const parsed = parseUrl(text);
  if (parsed === null || !ACCEPTED_SCHEMES.includes(parsed.protocol) || parsed.host === "") {
    return refuse("The address must start with libsql:// or https://.");
  }
  const token = parsed.searchParams.get(TOKEN_PARAM);
  parsed.searchParams.delete(TOKEN_PARAM);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const query = parsed.searchParams.toString();
  return {
    ok: true,
    url: `${parsed.protocol}//${parsed.host}${path}${query === "" ? "" : `?${query}`}`,
    token: token === null || token === "" ? null : token,
  };
}

/** The host a source row shows for a database address. */
export function databaseHost(url: string): string {
  return parseUrl(url)?.host || url;
}
