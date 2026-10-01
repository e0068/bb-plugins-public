import type { HranaFake } from "./hrana-fake.js";

/**
 * A stand-in for the Turso platform API (`https://api.turso.tech`) and the
 * region probe (`https://region.turso.io`). A database it creates becomes a
 * real database of the Hrana fake it was given, and a token it mints is one
 * that database accepts — so "Create" in a test ends in a board that works.
 * Every other address goes to the Hrana fake.
 */
export interface TursoFake {
  readonly fetch: typeof fetch;
  /** The account token the API accepts. */
  readonly accountToken: string;
  /** Group names of the organization, in creation order. */
  groups(): string[];
  /** Databases of the organization, in creation order. */
  databases(): { name: string; url: string }[];
  /** `METHOD path` of every API call, in order. */
  calls(): string[];
}

export interface TursoFakeOptions {
  accountToken?: string;
  /** Groups the organization already has. Default: none. */
  groups?: string[];
  /** Database names already taken in the organization. */
  takenNames?: string[];
  organizations?: { slug: string; type: string }[];
}

const ORG_PATH = /^\/v1\/organizations\/([^/]+)(\/.*)?$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function createTursoFake(hrana: HranaFake, options: TursoFakeOptions = {}): TursoFake {
  const accountToken = options.accountToken ?? "turso-account-token";
  const organizations = options.organizations ?? [
    { slug: "team", type: "team" },
    { slug: "me", type: "personal" },
  ];
  const groups = [...(options.groups ?? [])];
  const databases: { name: string; host: string }[] = (options.takenNames ?? []).map((name) => {
    const host = `${name}-me.turso.io`;
    hrana.addDatabase(host, `token-of-${name}`);
    return { name, host };
  });
  const calls: string[] = [];
  let minted = 0;

  const api = async (url: URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${accountToken}`) {
      return json(401, { error: "could not parse jwt" });
    }
    if (url.pathname === "/v1/organizations" && method === "GET") return json(200, organizations);
    const match = ORG_PATH.exec(url.pathname);
    if (match === null || !organizations.some((org) => org.slug === match[1])) return json(404, { error: "not found" });
    const rest = match[2] ?? "";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (rest === "/groups" && method === "GET") {
      return json(200, { groups: groups.map((name) => ({ name, locations: ["fra"], primary: "fra" })) });
    }
    if (rest === "/groups" && method === "POST") {
      if (typeof body.name !== "string" || typeof body.location !== "string") return json(400, { error: "name and location are required" });
      groups.push(body.name);
      return json(200, { group: { name: body.name, locations: [body.location], primary: body.location } });
    }
    if (rest === "/databases" && method === "GET") {
      return json(200, { databases: databases.map((db) => ({ Name: db.name, Hostname: db.host, DbId: `id-${db.name}` })) });
    }
    if (rest === "/databases" && method === "POST") {
      const name = body.name;
      if (typeof name !== "string" || !groups.includes(String(body.group))) return json(400, { error: "invalid database" });
      if (databases.some((db) => db.name === name)) return json(409, { error: `database with name ${name} already exists` });
      const host = `${name}-${match[1]}.turso.io`;
      hrana.addDatabase(host, `never-given-out-${name}`);
      databases.push({ name, host });
      return json(200, { database: { Name: name, Hostname: host, DbId: `id-${name}` } });
    }
    const token = /^\/databases\/([^/]+)\/auth\/tokens$/.exec(rest);
    if (token !== null && method === "POST") {
      const database = databases.find((db) => db.name === token[1]);
      if (database === undefined) return json(404, { error: "database not found" });
      minted += 1;
      const jwt = `jwt-${database.name}-${minted}`;
      hrana.allowToken(database.host, jwt);
      return json(200, { jwt });
    }
    return json(404, { error: "not found" });
  };

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.host === "api.turso.tech") return api(url, init);
    if (url.host === "region.turso.io") return json(200, { server: "fra", client: "fra" });
    return hrana.fetch(input, init);
  };

  return {
    fetch: fakeFetch as typeof fetch,
    accountToken,
    groups: () => [...groups],
    databases: () => databases.map((db) => ({ name: db.name, url: `libsql://${db.host}` })),
    calls: () => [...calls],
  };
}
