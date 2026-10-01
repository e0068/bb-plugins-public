// @vitest-environment node
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tasksHost, type TasksHost } from "../test-support/tasks-host.js";

const hosts: TasksHost[] = [];
const dirs: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.env.PATH = originalPath;
});

/** Puts a `turso` script first on the PATH: it runs the given shell body. */
function tursoOnPath(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "turso-cli-"));
  dirs.push(dir);
  const script = join(dir, "turso");
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
  process.env.PATH = `${dir}:${originalPath ?? ""}`;
  return dir;
}

async function machine() {
  const host = await tasksHost({ machine: "Mac mini" });
  hosts.push(host);
  return host;
}

describe("Generate: a Turso API token from the CLI of the host", () => {
  it("answers the token the CLI minted, minted under a bb-tasks-plus name", async () => {
    const dir = tursoOnPath(`echo "$@" > "$(dirname "$0")/args"; echo jwt-from-cli`);
    const a = await machine();
    expect(await a.call("generateTursoApiToken")).toEqual({ ok: true, token: "jwt-from-cli" });
    expect(readFileSync(join(dir, "args"), "utf8")).toMatch(/^auth api-tokens mint bb-tasks-plus-\d{14}\n$/);
  });

  it("says when the CLI is not logged in", async () => {
    tursoOnPath(`echo "Error: user not logged in, please login with turso auth login" >&2; exit 1`);
    const a = await machine();
    expect(await a.call("generateTursoApiToken")).toMatchObject({ ok: false, reason: "not_logged_in" });
  });

  it("does not save the token: Create saves it once Turso accepts it", async () => {
    tursoOnPath("echo jwt-from-cli");
    const a = await machine();
    await a.call("generateTursoApiToken");
    expect(await a.call("hasTursoApiToken")).toEqual({ saved: false });
  });
});
