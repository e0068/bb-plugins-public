// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";

const secretsPath = "./database-secrets.js";
const { createDatabaseSecrets } = await planned<typeof import("./database-secrets.js")>(() => import(/* @vite-ignore */ secretsPath));

describe("the tokens a database board needs, kept in secret settings", () => {
  it("declares both settings as secrets", () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    createDatabaseSecrets(bb);
    const descriptors = harness.registrations.settingsDescriptors as Record<string, { secret?: boolean }>;
    expect(descriptors.tursoApiToken?.secret).toBe(true);
    expect(descriptors.databaseTokens?.secret).toBe(true);
  });

  it("has no Turso token until one is saved, and gives back the one saved", async () => {
    const { bb } = createFakePluginHost({ pluginId: "tasks" });
    const secrets = createDatabaseSecrets(bb);
    expect(await secrets.tursoApiToken()).toBeNull();
    await secrets.saveTursoApiToken("account-token");
    expect(await secrets.tursoApiToken()).toBe("account-token");
  });

  it("keeps one token per database address", async () => {
    const { bb } = createFakePluginHost({ pluginId: "tasks" });
    const secrets = createDatabaseSecrets(bb);
    await secrets.saveDatabaseToken("libsql://a-me.turso.io", "token-a");
    await secrets.saveDatabaseToken("libsql://b-me.turso.io", "token-b");
    expect(await secrets.databaseToken("libsql://a-me.turso.io")).toBe("token-a");
    expect(await secrets.databaseToken("libsql://b-me.turso.io")).toBe("token-b");
    expect(await secrets.databaseToken("libsql://c-me.turso.io")).toBeNull();
  });

  it("reads tokens saved before the plugin loaded, and treats a broken record as none", async () => {
    const saved = createFakePluginHost({ pluginId: "tasks", settings: { databaseTokens: JSON.stringify({ "libsql://a-me.turso.io": "token-a" }), tursoApiToken: "account" } });
    const secrets = createDatabaseSecrets(saved.bb);
    expect(await secrets.databaseToken("libsql://a-me.turso.io")).toBe("token-a");
    expect(await secrets.tursoApiToken()).toBe("account");
    const broken = createFakePluginHost({ pluginId: "tasks", settings: { databaseTokens: "{not json" } });
    expect(await createDatabaseSecrets(broken.bb).databaseToken("libsql://a-me.turso.io")).toBeNull();
  });
});
