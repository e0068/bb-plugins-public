// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cliTokenName, mintCliApiToken, readMintRun, tursoCliCandidates, type CliExecFile } from "./turso-cli.js";

const missing = Object.assign(new Error("spawn turso ENOENT"), { code: "ENOENT" });
const exited = Object.assign(new Error("Command failed"), { code: 1 });

describe("the name a minted token gets", () => {
  it("is bb-tasks-plus and the UTC second it was minted", () => {
    expect(cliTokenName(new Date("2026-10-01T06:07:08.900Z"))).toBe("bb-tasks-plus-20261001060708");
  });

  it("differs for different seconds and never holds a space", () => {
    const seconds = fc.integer({ min: 0, max: 4_000_000_000 });
    fc.assert(
      fc.property(seconds, seconds, (a, b) => {
        const nameA = cliTokenName(new Date(a * 1000));
        expect(nameA).toMatch(/^bb-tasks-plus-\d{14}$/);
        if (a !== b) expect(nameA).not.toBe(cliTokenName(new Date(b * 1000)));
      }),
    );
  });
});

describe("where the turso CLI is looked for", () => {
  it("the PATH first, then Homebrew, /usr/local and the Turso installer's folder", () => {
    expect(tursoCliCandidates("/Users/me")).toEqual(["turso", "/opt/homebrew/bin/turso", "/usr/local/bin/turso", "/Users/me/.turso/turso"]);
  });
});

describe("a run the timeout killed", () => {
  it("says the CLI did not answer in time", () => {
    const killed = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
    expect(readMintRun({ error: killed, stdout: "", stderr: "" })).toEqual({ kind: "failed", message: "The turso CLI did not answer in 20 s." });
  });
});

describe("what one run of turso auth api-tokens mint says", () => {
  it("a token is the last line it printed", () => {
    expect(readMintRun({ error: null, stdout: "eyJhbGciOi.abc.def\n", stderr: "" })).toEqual({ kind: "ok", token: "eyJhbGciOi.abc.def" });
  });

  it("no binary at that path is missing, whatever else came", () => {
    expect(readMintRun({ error: missing, stdout: "", stderr: "" })).toEqual({ kind: "missing" });
  });

  it("no login is told apart, colours and all", () => {
    const stderr = "Error: user not logged in, please login with \u001b[1mturso auth login\u001b[0m\n";
    expect(readMintRun({ error: exited, stdout: "", stderr })).toEqual({ kind: "not_logged_in" });
  });

  it("no login printed to stdout is told apart too, whatever the exit", () => {
    const stdout = "You are not logged in, please login with turso auth login before running other commands.\n";
    expect(readMintRun({ error: null, stdout, stderr: "" })).toEqual({ kind: "not_logged_in" });
    expect(readMintRun({ error: exited, stdout, stderr: "" })).toEqual({ kind: "not_logged_in" });
  });

  it("a refusal printed only to stdout carries its first line", () => {
    const stdout = "\u001b[31mError:\u001b[0m organization acme not found\nsecond line\n";
    expect(readMintRun({ error: exited, stdout, stderr: "" })).toEqual({ kind: "failed", message: "organization acme not found" });
  });

  it("a refusal printed to stdout with exit 0 carries its first line too", () => {
    expect(readMintRun({ error: null, stdout: "Error: organization acme not found\n", stderr: "" })).toEqual({
      kind: "failed",
      message: "organization acme not found",
    });
  });

  it("any other refusal carries its first line, without colours and the Error: prefix", () => {
    const stderr = "\n\u001b[31mError:\u001b[0m organization acme not found\nsecond line\n";
    expect(readMintRun({ error: exited, stdout: "", stderr })).toEqual({ kind: "failed", message: "organization acme not found" });
  });

  it("a run that printed nothing, or words instead of a token, has failed", () => {
    expect(readMintRun({ error: null, stdout: "  \n", stderr: "" })).toMatchObject({ kind: "failed" });
    expect(readMintRun({ error: null, stdout: "Update available: v2\n", stderr: "" })).toMatchObject({ kind: "failed" });
  });

  it("a failure with nothing on stderr says the command failed", () => {
    expect(readMintRun({ error: exited, stdout: "", stderr: "" })).toEqual({ kind: "failed", message: "turso auth api-tokens mint failed" });
  });
});

/** An execFile that answers each binary path from a table and records what it ran. */
function fakeExecFile(answers: Record<string, { error: Error | null; stdout: string; stderr: string }>) {
  const ran: { file: string; args: readonly string[] }[] = [];
  const execFile: CliExecFile = (file, args, _options, callback) => {
    ran.push({ file, args });
    const answer = answers[file] ?? { error: missing, stdout: "", stderr: "" };
    callback(answer.error, answer.stdout, answer.stderr);
  };
  return { execFile, ran };
}

const NOW = new Date("2026-10-01T06:07:08Z");

describe("minting a token through the CLI", () => {
  it("runs mint with the token name on the first binary that exists", async () => {
    const fake = fakeExecFile({ "/opt/homebrew/bin/turso": { error: null, stdout: "jwt-token\n", stderr: "" } });
    const result = await mintCliApiToken({ execFile: fake.execFile, candidates: tursoCliCandidates("/Users/me"), now: NOW });
    expect(result).toEqual({ ok: true, token: "jwt-token" });
    expect(fake.ran.map((run) => run.file)).toEqual(["turso", "/opt/homebrew/bin/turso"]);
    expect(fake.ran[1]!.args).toEqual(["auth", "api-tokens", "mint", "bb-tasks-plus-20261001060708"]);
  });

  it("no binary anywhere is cli_missing", async () => {
    const fake = fakeExecFile({});
    const result = await mintCliApiToken({ execFile: fake.execFile, candidates: tursoCliCandidates("/Users/me"), now: NOW });
    expect(result).toMatchObject({ ok: false, reason: "cli_missing" });
    expect(fake.ran).toHaveLength(4);
  });

  it("stops at the first binary that answered, even with a refusal", async () => {
    const fake = fakeExecFile({ turso: { error: exited, stdout: "", stderr: "Error: user not logged in, please login with turso auth login" } });
    const result = await mintCliApiToken({ execFile: fake.execFile, candidates: tursoCliCandidates("/Users/me"), now: NOW });
    expect(result).toMatchObject({ ok: false, reason: "not_logged_in" });
    expect(fake.ran).toHaveLength(1);
  });

  it("a refusal keeps the CLI's words", async () => {
    const fake = fakeExecFile({ turso: { error: exited, stdout: "", stderr: "Error: quota exceeded" } });
    const result = await mintCliApiToken({ execFile: fake.execFile, candidates: ["turso"], now: NOW });
    expect(result).toEqual({ ok: false, reason: "failed", message: "quota exceeded" });
  });
});
