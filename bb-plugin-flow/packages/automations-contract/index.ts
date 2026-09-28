// The public entry of the Automations plugin (bb-plugin-automations-builder)
// as seen from another plugin: where its HTTP routes live, what they take and
// answer, and a client that never throws. Automations' server answers these
// shapes; Flow's server and front end call them. No imports at all: the
// package is bundled into both plugins, and a third-party import here breaks a
// git install (see packages/layer-guard, "Сторож git-установки").

export const AUTOMATIONS_PLUGIN_ID = "automations-builder";

export const AUTOMATIONS_PATHS = { catalog: "catalog", emit: "emit", run: "run" } as const;
export type AutomationsPath = keyof typeof AUTOMATIONS_PATHS;

/** `/api/v1/plugins/automations-builder/http/<path>` under the base; an empty base is the page's own origin. */
export const automationsUrl = (baseUrl: string, path: AutomationsPath): string =>
  `${baseUrl}/api/v1/plugins/${AUTOMATIONS_PLUGIN_ID}/http/${AUTOMATIONS_PATHS[path]}`;

export interface AutomationSummary {
  id: string;
  name: string;
  enabled: boolean;
  /** Подписи действий автоматизации по порядку; нет — Automations до шагов в каталоге. */
  steps?: string[];
}

/** A trigger, condition or action of the catalog. */
export interface CatalogItem {
  id: string;
  label: string;
  group: string;
}

export interface CatalogResponse {
  automations: AutomationSummary[];
  triggers: CatalogItem[];
  conditions: CatalogItem[];
  actions: CatalogItem[];
}

/** Tells Automations an event of another plugin happened; automations holding the trigger run. */
export interface EmitRequest {
  trigger: string;
  threadId: string;
  context?: { stageId?: string };
}

/** Runs one automation by id, or one action by id (no conditions), on a thread. */
export type RunRequest = { threadId: string; automationId: string } | { threadId: string; actionId: string };

export type RunSkip = "disabled" | "missing" | "conditions";

export interface RunResponse {
  /** The actions that ran, in order. */
  executed: string[];
  /** Why nothing ran, or `null` when the automation ran. */
  skipped: RunSkip | null;
  /** The message of a step that failed, or `null`. */
  error: string | null;
}

export type ClientFailure = { ok: false; reason: "not-installed" | "http" | "network" | "timeout" | "bad-response"; status?: number };
export type ClientResult<T> = { ok: true; value: T } | ClientFailure;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isString = (x: unknown): x is string => typeof x === "string";
const isItem = (x: unknown): x is CatalogItem => isRecord(x) && isString(x.id) && isString(x.label) && isString(x.group);
const listOf = <T>(x: unknown, is: (item: unknown) => item is T): x is T[] => Array.isArray(x) && x.every(is);

export const isCatalogResponse = (x: unknown): x is CatalogResponse =>
  isRecord(x) &&
  listOf(x.automations, (a): a is AutomationSummary => isRecord(a) && isString(a.id) && isString(a.name) && typeof a.enabled === "boolean" && (a.steps === undefined || listOf(a.steps, isString))) &&
  listOf(x.triggers, isItem) &&
  listOf(x.conditions, isItem) &&
  listOf(x.actions, isItem);

export const isRunResponse = (x: unknown): x is RunResponse =>
  isRecord(x) &&
  listOf(x.executed, isString) &&
  (x.skipped === null || x.skipped === "disabled" || x.skipped === "missing" || x.skipped === "conditions") &&
  (x.error === null || isString(x.error));

export interface ClientOptions {
  /** Sent as `origin` — a server-side caller passes bb's loopback URL so the "local" route accepts it. */
  origin?: string;
  /** Aborts a request that takes longer; none by default. */
  timeoutMs?: number;
}

export interface AutomationsClient {
  catalog(): Promise<ClientResult<CatalogResponse>>;
  emit(request: EmitRequest): Promise<ClientResult<null>>;
  run(request: RunRequest): Promise<ClientResult<RunResponse>>;
}

export function automationsClient(baseUrl: string, fetchImpl: typeof fetch, options: ClientOptions = {}): AutomationsClient {
  const request = async <T>(path: AutomationsPath, body: unknown, accept: (x: unknown) => ClientResult<T>): Promise<ClientResult<T>> => {
    const headers: Record<string, string> = options.origin === undefined ? {} : { origin: options.origin };
    const init: RequestInit =
      body === undefined ? { method: "GET", headers } : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) };
    let response: Response;
    try {
      response = await fetchImpl(automationsUrl(baseUrl, path), options.timeoutMs === undefined ? init : { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { ok: false, reason: timedOut ? "timeout" : "network" };
    }
    if (response.status === 404) return { ok: false, reason: "not-installed", status: 404 };
    if (!response.ok) return { ok: false, reason: "http", status: response.status };
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, reason: "bad-response", status: response.status };
    }
    return accept(parsed);
  };
  const shaped =
    <T>(is: (x: unknown) => x is T) =>
    (x: unknown): ClientResult<T> =>
      is(x) ? { ok: true, value: x } : { ok: false, reason: "bad-response" };
  return {
    catalog: () => request("catalog", undefined, shaped(isCatalogResponse)),
    emit: (body) => request("emit", body, () => ({ ok: true, value: null })),
    run: (body) => request("run", body, shaped(isRunResponse)),
  };
}
