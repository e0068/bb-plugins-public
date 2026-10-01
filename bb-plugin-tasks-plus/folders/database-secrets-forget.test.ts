// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";

const secretsPath = "./database-secrets.js";
const { createDatabaseSecrets } = await planned<typeof import("./database-secrets.js")>(() => import(/* @vite-ignore */ secretsPath));

describe("forgetting the token of a disconnected database", () => {
  it("drops the token of that address and keeps the others", async () => {
    const { bb } = createFakePluginHost({ pluginId: "tasks" });
    const secrets = createDatabaseSecrets(bb);
    await secrets.saveDatabaseToken("libsql://a-me.turso.io", "token-a");
    await secrets.saveDatabaseToken("libsql://b-me.turso.io", "token-b");
    await secrets.forgetDatabaseToken("libsql://a-me.turso.io");
    expect(await secrets.databaseToken("libsql://a-me.turso.io")).toBeNull();
    expect(await secrets.databaseToken("libsql://b-me.turso.io")).toBe("token-b");
  });

  it("leaves the record as it is for an address with no token", async () => {
    const { bb } = createFakePluginHost({ pluginId: "tasks" });
    const secrets = createDatabaseSecrets(bb);
    await secrets.saveDatabaseToken("libsql://b-me.turso.io", "token-b");
    await secrets.forgetDatabaseToken("libsql://none-me.turso.io");
    expect(await secrets.databaseToken("libsql://b-me.turso.io")).toBe("token-b");
  });
});
