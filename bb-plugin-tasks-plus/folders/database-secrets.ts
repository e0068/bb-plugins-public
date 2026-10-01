import type { BbPluginApi, PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The tokens a database board needs, kept in the plugin's secret settings:
 * the Turso account token, and one token per database address.
 */
export interface DatabaseSecrets {
  tursoApiToken(): Promise<string | null>;
  saveTursoApiToken(token: string): Promise<void>;
  databaseToken(url: string): Promise<string | null>;
  saveDatabaseToken(url: string, token: string): Promise<void>;
}

const SETTINGS = {
  tursoApiToken: { type: "string", secret: true, label: "Turso API token", description: "Managed by the Tasks+ folders page." },
  databaseTokens: { type: "string", secret: true, label: "Database tokens", description: "Managed by the Tasks+ folders page." },
} satisfies PluginSettingDescriptors;

const tokensByUrlSchema = z.record(z.string(), z.string());

type TokensByUrl = z.infer<typeof tokensByUrlSchema>;

/** A missing or broken record is an empty one. */
function readTokens(stored: string | undefined): TokensByUrl {
  if (stored === undefined) return {};
  try {
    const parsed = tokensByUrlSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

const orNull = (value: string | undefined): string | null => (value === undefined || value === "" ? null : value);

/** Declares the settings, so it is called once per plugin load. */
export function createDatabaseSecrets(bb: BbPluginApi): DatabaseSecrets {
  const settings = bb.settings.define(SETTINGS);
  const tokens = async (): Promise<TokensByUrl> => readTokens((await settings.get()).databaseTokens);
  return {
    tursoApiToken: async () => orNull((await settings.get()).tursoApiToken),
    saveTursoApiToken: async (token) => {
      await settings.experimental_set({ tursoApiToken: token });
    },
    databaseToken: async (url) => orNull((await tokens())[url]),
    saveDatabaseToken: async (url, token) => {
      await settings.experimental_set({ databaseTokens: JSON.stringify({ ...(await tokens()), [url]: token }) });
    },
  };
}
