import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";

const addressPath = "./database-address.js";
const { databaseInvite, parseDatabaseAddress } = await planned<typeof import("./database-address.js")>(() => import(/* @vite-ignore */ addressPath));

const host = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}(\.[a-z][a-z0-9-]{0,10}){1,3}$/);
const address = fc.tuple(fc.constantFrom("libsql", "https"), host, fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined })).map(
  ([scheme, name, port]) => `${scheme}://${name}${port === undefined ? "" : `:${port}`}`,
);
const token = fc.string({ minLength: 1 }).filter((text) => text.trim() !== "");

describe("an invite to a database board", () => {
  it("parses back into the same address and the same token", () => {
    fc.assert(
      fc.property(address, token, (raw, secret) => {
        const parsed = parseDatabaseAddress(raw);
        if (!parsed.ok) return;
        expect(parseDatabaseAddress(databaseInvite(parsed.url, secret))).toEqual({ ok: true, url: parsed.url, token: secret });
      }),
    );
  });

  it("is the address with the token as ?authToken=", () => {
    expect(databaseInvite("libsql://board-me.turso.io", "abc.def")).toBe("libsql://board-me.turso.io?authToken=abc.def");
  });
});
