import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";

const addressPath = "./database-address.js";
const { parseDatabaseAddress, databaseHost } = await planned<typeof import("./database-address.js")>(() => import(/* @vite-ignore */ addressPath));

describe("an address typed into Connect database", () => {
  it("takes a libsql address as it is, with no token", () => {
    expect(parseDatabaseAddress("  libsql://board-me.turso.io ")).toEqual({ ok: true, url: "libsql://board-me.turso.io", token: null });
  });

  it("takes the token out of an address that carries ?authToken=", () => {
    expect(parseDatabaseAddress("libsql://board-me.turso.io?authToken=abc.def")).toEqual({ ok: true, url: "libsql://board-me.turso.io", token: "abc.def" });
  });

  it("accepts an https address of a self-hosted sqld", () => {
    expect(parseDatabaseAddress("https://sqld.example.com:8080")).toEqual({ ok: true, url: "https://sqld.example.com:8080", token: null });
  });

  it("refuses a blank address and one of another scheme", () => {
    for (const raw of ["", "   ", "ftp://x", "board-me.turso.io"]) {
      expect(parseDatabaseAddress(raw)).toMatchObject({ ok: false });
    }
  });

  it("names the host a row shows", () => {
    expect(databaseHost("libsql://board-me.turso.io")).toBe("board-me.turso.io");
  });
});
