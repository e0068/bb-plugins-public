import type { BbPluginApi, PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The tokens a database board needs: the Turso account token, and one token
 * per database address. They live in the plugin's kv beside the boards, not
 * in bb's secret settings: bb erases a plugin's settings and secrets every
 * time the plugin is removed — a reinstall, an update, a move between sources
 * — while the kv, and the boards in it, stay. A token kept in a secret left
 * the board behind it without a token after each such reinstall.
 */
export interface DatabaseSecrets {
  tursoApiToken(): Promise<string | null>;
  saveTursoApiToken(token: string): Promise<void>;
  databaseToken(url: string): Promise<string | null>;
  saveDatabaseToken(url: string, token: string): Promise<void>;
  forgetDatabaseToken(url: string): Promise<void>;
}

/** Where the tokens used to be kept; declared still, so that tokens saved there can move to the kv. */
const SETTINGS = {
  tursoApiToken: { type: "string", secret: true, label: "Turso API token", description: "Legacy: moved into Tasks+ on load. Enter tokens in Connect database." },
  databaseTokens: { type: "string", secret: true, label: "Database tokens", description: "Legacy: moved into Tasks+ on load. Enter tokens in Connect database." },
} satisfies PluginSettingDescriptors;

export const TOKENS_KV_KEY = "database-tokens";

const tokensSchema = z.object({
  tursoApiToken: z.string().nullable(),
  databases: z.record(z.string(), z.string()),
});

type Tokens = z.infer<typeof tokensSchema>;

const NO_TOKENS: Tokens = { tursoApiToken: null, databases: {} };

const tokensByUrlSchema = z.record(z.string(), z.string());

/** A missing or broken record is an empty one. */
function readTokensByUrl(stored: string | undefined): Record<string, string> {
  if (stored === undefined) return {};
  try {
    const parsed = tokensByUrlSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

const orNull = (value: string | undefined | null): string | null => (value === undefined || value === null || value === "" ? null : value);

/** The kv record, with what the secret settings still hold added where the kv has nothing: the kv wins. */
export function withSecretsMoved(kept: Tokens, secret: { tursoApiToken?: string; databaseTokens?: string }): Tokens {
  return {
    tursoApiToken: kept.tursoApiToken ?? orNull(secret.tursoApiToken),
    databases: { ...readTokensByUrl(secret.databaseTokens), ...kept.databases },
  };
}

/** Declares the settings, so it is called once per plugin load. */
export function createDatabaseSecrets(bb: BbPluginApi): DatabaseSecrets {
  const settings = bb.settings.define(SETTINGS);

  const readKept = async (): Promise<Tokens> => {
    const parsed = tokensSchema.safeParse(await bb.storage.kv.get<unknown>(TOKENS_KV_KEY));
    return parsed.success ? parsed.data : NO_TOKENS;
  };

  /** Tokens still in the secret settings move to the kv once, on first use; the secrets are emptied after, so a token forgotten later does not come back from them. */
  const moveFromSecrets = async (): Promise<void> => {
    const secret = await settings.get();
    if (orNull(secret.tursoApiToken) === null && orNull(secret.databaseTokens) === null) return;
    await bb.storage.kv.set(TOKENS_KV_KEY, withSecretsMoved(await readKept(), secret));
    await settings.experimental_set({ tursoApiToken: null, databaseTokens: null });
  };

  let moved: Promise<void> | null = null;
  /** One change at a time: two saves that read the record together would drop one of the tokens. */
  let queue: Promise<unknown> = Promise.resolve();

  const ready = (): Promise<void> => {
    moved ??= moveFromSecrets().catch((error: unknown) => {
      moved = null;
      bb.log.warn(`tasks-plus: moving database tokens out of secret settings failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return moved;
  };

  const read = async (): Promise<Tokens> => {
    await ready();
    return readKept();
  };

  const change = (next: (tokens: Tokens) => Tokens): Promise<void> => {
    const run = queue.then(async () => {
      await bb.storage.kv.set(TOKENS_KV_KEY, next(await read()));
    });
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    tursoApiToken: async () => (await read()).tursoApiToken,
    saveTursoApiToken: (token) => change((tokens) => ({ ...tokens, tursoApiToken: token })),
    databaseToken: async (url) => orNull((await read()).databases[url]),
    saveDatabaseToken: (url, token) => change((tokens) => ({ ...tokens, databases: { ...tokens.databases, [url]: token } })),
    forgetDatabaseToken: (url) =>
      change((tokens) => {
        const { [url]: _forgotten, ...kept } = tokens.databases;
        return { ...tokens, databases: kept };
      }),
  };
}
