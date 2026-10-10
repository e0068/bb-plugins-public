import { z } from "zod";

/**
 * The Turso platform API — enough of it to give a board a database without
 * opening the console: the organization, a group, the database, a token.
 * Every failure is a value; the account token goes only into the request
 * header and never into a result.
 */

export type TursoError =
  | { kind: "auth" }
  | { kind: "unreachable" }
  | { kind: "timeout"; ms: number }
  | { kind: "name_taken" }
  | { kind: "api"; message: string };

export type TursoResult<T> = { ok: true; value: T } | { ok: false; error: TursoError };

export interface TursoDatabase {
  name: string;
  url: string;
}

export interface TursoApi {
  organization(): Promise<TursoResult<string>>;
  ensureGroup(org: string): Promise<TursoResult<string>>;
  createDatabase(org: string, baseName: string, group: string): Promise<TursoResult<TursoDatabase>>;
  listDatabases(org: string): Promise<TursoResult<TursoDatabase[]>>;
  mintToken(org: string, name: string): Promise<TursoResult<string>>;
}

const API_ORIGIN = "https://api.turso.tech";
const REGION_URL = "https://region.turso.io";
const DEFAULT_GROUP = "default";
const NAME_PREFIX = "bb-tasks-";
const LAST_SUFFIX = 9;
const HTTP_CONFLICT = 409;
/** How long one request waits for Turso before it gives up. */
export const TURSO_TIMEOUT_MS = 20_000;

const organizationsSchema = z.array(z.object({ slug: z.string(), type: z.string() }));
const groupsSchema = z.object({ groups: z.array(z.object({ name: z.string() })) });
const groupSchema = z.object({ group: z.object({ name: z.string() }) });
const regionSchema = z.object({ server: z.string() });
const databaseEntrySchema = z.object({ Name: z.string(), Hostname: z.string() });
const databaseSchema = z.object({ database: databaseEntrySchema });
const databasesSchema = z.object({ databases: z.array(databaseEntrySchema) });
const tokenSchema = z.object({ jwt: z.string() });

/** The name of the database a board with this prefix asks for. */
export function databaseBaseName(prefix: string): string {
  return `${NAME_PREFIX}${prefix.toLowerCase()}`;
}

const succeed = <T>(value: T): TursoResult<T> => ({ ok: true, value });
const fail = <T>(error: TursoError): TursoResult<T> => ({ ok: false, error });

const toDatabase = (entry: z.infer<typeof databaseEntrySchema>): TursoDatabase => ({
  name: entry.Name,
  url: `libsql://${entry.Hostname}`,
});

type Sent = { ok: true; body: unknown } | { ok: false; error: TursoError; status: number | null };

/** The words of a refusal: the `error` of a JSON answer, else the text as it came. */
function refusalMessage(text: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON — the text itself is the message
  }
  return text.trim() === "" ? `HTTP ${status}` : text.trim();
}

function statusError(status: number, text: string): TursoError {
  return status === 401 || status === 403 ? { kind: "auth" } : { kind: "api", message: refusalMessage(text, status) };
}

async function readJson(response: Response): Promise<Sent> {
  const text = await response.text();
  if (!response.ok) return { ok: false, error: statusError(response.status, text), status: response.status };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, error: { kind: "api", message: "the answer is not JSON" }, status: response.status };
  }
}

function parsed<S extends z.ZodType>(schema: S, sent: Sent): TursoResult<z.infer<S>> {
  if (!sent.ok) return fail(sent.error);
  const result = schema.safeParse(sent.body);
  return result.success ? succeed(result.data) : fail({ kind: "api", message: `unexpected answer: ${result.error.message}` });
}

function chain<A, B>(first: TursoResult<A>, next: (value: A) => Promise<TursoResult<B>>): Promise<TursoResult<B>> {
  return first.ok ? next(first.value) : Promise.resolve(fail(first.error));
}

export function createTursoApi(options: { token: string; fetch?: typeof fetch; timeoutMs?: number }): TursoApi {
  const ms = options.timeoutMs ?? TURSO_TIMEOUT_MS;
  const send = async (url: string, init: RequestInit): Promise<Sent> => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const signal = AbortSignal.timeout(ms);
    try {
      return await readJson(await doFetch(url, { ...init, signal }));
    } catch {
      return { ok: false, error: signal.aborted ? { kind: "timeout", ms } : { kind: "unreachable" }, status: null };
    }
  };

  const call = (method: "GET" | "POST", path: string, body?: unknown): Promise<Sent> =>
    send(`${API_ORIGIN}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const orgPath = (org: string): string => `/v1/organizations/${encodeURIComponent(org)}`;

  const organization = async (): Promise<TursoResult<string>> => {
    const listed = parsed(organizationsSchema, await call("GET", "/v1/organizations"));
    if (!listed.ok) return listed;
    const chosen = listed.value.find((org) => org.type === "personal") ?? listed.value[0];
    return chosen === undefined ? fail({ kind: "api", message: "the account has no organization" }) : succeed(chosen.slug);
  };

  const createGroup = async (org: string): Promise<TursoResult<string>> => {
    const region = parsed(regionSchema, await send(REGION_URL, { method: "GET" }));
    return chain(region, async ({ server }) => {
      const created = parsed(groupSchema, await call("POST", `${orgPath(org)}/groups`, { name: DEFAULT_GROUP, location: server }));
      return created.ok ? succeed(created.value.group.name) : created;
    });
  };

  const ensureGroup = async (org: string): Promise<TursoResult<string>> => {
    const listed = parsed(groupsSchema, await call("GET", `${orgPath(org)}/groups`));
    return chain(listed, async ({ groups }) => (groups[0] === undefined ? createGroup(org) : succeed(groups[0].name)));
  };

  const candidateName = (baseName: string, attempt: number): string => (attempt === 1 ? baseName : `${baseName}-${attempt}`);

  const createDatabaseAt = async (org: string, baseName: string, group: string, attempt: number): Promise<TursoResult<TursoDatabase>> => {
    const sent = await call("POST", `${orgPath(org)}/databases`, { name: candidateName(baseName, attempt), group });
    if (!sent.ok && sent.status === HTTP_CONFLICT) {
      return attempt >= LAST_SUFFIX ? fail({ kind: "name_taken" }) : createDatabaseAt(org, baseName, group, attempt + 1);
    }
    const created = parsed(databaseSchema, sent);
    return created.ok ? succeed(toDatabase(created.value.database)) : created;
  };

  const listDatabases = async (org: string): Promise<TursoResult<TursoDatabase[]>> => {
    const listed = parsed(databasesSchema, await call("GET", `${orgPath(org)}/databases`));
    return listed.ok ? succeed(listed.value.databases.map(toDatabase)) : listed;
  };

  const mintToken = async (org: string, name: string): Promise<TursoResult<string>> => {
    const minted = parsed(
      tokenSchema,
      await call("POST", `${orgPath(org)}/databases/${encodeURIComponent(name)}/auth/tokens?expiration=never&authorization=full-access`),
    );
    return minted.ok ? succeed(minted.value.jwt) : minted;
  };

  return {
    organization,
    ensureGroup,
    createDatabase: (org, baseName, group) => createDatabaseAt(org, baseName, group, 1),
    listDatabases,
    mintToken,
  };
}
