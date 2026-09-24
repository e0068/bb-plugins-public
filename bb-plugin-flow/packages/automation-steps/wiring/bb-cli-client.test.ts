// The one stick with the world in this plugin's `bb` CLI path: a real
// child process, no fake. Deterministic without a real `bb` — the binary to
// spawn comes from the environment, so a stand-in that always exists
// (/bin/echo) proves the resolution is the thing being obeyed, and a path
// that cannot exist proves the failure shape.
import { describe, expect, it } from "vitest";
import { bbCliClient } from "./bb-cli-client";

describe("bbCliClient", () => {
  it("spawns the binary the environment names, passing argv through", async () => {
    const run = await bbCliClient({ BB_CLI: "/bin/echo" }).run(["tasks", "current"]);
    expect(run).toMatchObject({ kind: "ran", code: 0 });
    expect(run.kind === "ran" && run.stdout.trim()).toBe("tasks current");
  });

  // The env of a call, not of the plugin host: `bb tasks` resolves a task
  // against the tree of BB_THREAD_ID, and the host process has no thread.
  it("passes the call's own environment variables to the process", async () => {
    const run = await bbCliClient({ BB_CLI: "/bin/sh" }).run(
      ["-c", 'printf %s "$BB_THREAD_ID"'],
      { BB_THREAD_ID: "thr_abc" },
    );
    expect(run.kind === "ran" && run.stdout).toBe("thr_abc");
  });

  it("a non-zero exit is an ordinary outcome, not a throw", async () => {
    const run = await bbCliClient({ BB_CLI: "/bin/sh" }).run(["-c", "exit 7"]);
    expect(run).toMatchObject({ kind: "ran", code: 7 });
  });

  it("the binary does not exist → unavailable, kept apart from any exit code", async () => {
    const run = await bbCliClient({ BB_CLI: "/nonexistent/bb" }).run(["tasks", "current"]);
    expect(run.kind).toBe("unavailable");
    expect(run.kind === "unavailable" && run.reason).toMatch(/ENOENT/);
  });
});
