// Exercises the real node:child_process-backed adapter. Uses `node` itself
// as the test subprocess (always available in this repo's toolchain) so
// these tests don't depend on python being installed.
import { describe, expect, it } from "vitest";
import { runProcess } from "../process-runner";

describe("runProcess (real adapter)", () => {
  it("returns stdout and a zero exit code for a successful run", async () => {
    const result = await runProcess("node", ["-e", "process.stdout.write('hello')"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toBe("hello");
    expect(result.code).toBe(0);
  });

  it("captures stdout and a non-zero exit code without treating it as a failure", async () => {
    const result = await runProcess("node", ["-e", "process.stdout.write('partial'); process.exit(3)"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toBe("partial");
    expect(result.code).toBe(3);
  });

  it("reports ENOENT for a command that isn't on PATH as a recognized failure", async () => {
    const result = await runProcess("definitely-not-a-real-command-xyz", []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });

  it("kills a process that exceeds the timeout and reports it", async () => {
    const result = await runProcess("node", ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
  }, 10_000);

  it("kills a process whose stdout exceeds the byte cap and reports it", async () => {
    const result = await runProcess(
      "node",
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(1024)), 1)"],
      { maxOutputBytes: 4096 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("output_limit");
  }, 10_000);

  it("caps buffered stderr so a chatty process can't blow up plugin memory", async () => {
    // stdout stays tiny here -- only stderr is noisy -- so a successful run
    // (ok: true) is still expected; only the buffered stderr text must be
    // bounded, the same way stdout already is.
    const result = await runProcess(
      "node",
      ["-e", "for (let i = 0; i < 5000; i++) process.stderr.write('x'.repeat(1024)); process.stdout.write('done')"],
      { maxOutputBytes: 4096 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toBe("done");
    expect(result.stderr.length).toBeLessThanOrEqual(4096);
  }, 10_000);

  it("never rejects even when spawn() throws synchronously", async () => {
    // A NUL byte in the command makes Node's spawn() throw synchronously
    // ("path must be a string without null bytes") instead of emitting an
    // async 'error' event. The documented contract is "never rejects" --
    // this must come back as a tagged failure, not an unhandled rejection.
    // Built at runtime (String.fromCharCode) rather than as a literal
    // control character in the source file.
    const badCommand = "node" + String.fromCharCode(0) + "bad";
    const result = await runProcess(badCommand, []);
    expect(result.ok).toBe(false);
  });
});
