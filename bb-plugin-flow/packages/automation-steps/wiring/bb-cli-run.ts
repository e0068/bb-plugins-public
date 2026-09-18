// Layer 3 (shell) — the shared effect port for running the `bb` CLI and
// parsing its output into a readable message. Mirrors git-run.ts; the actual
// process is spawned by bb-cli-client.ts.
//
// A run has two shapes, not one: the CLI ran (and said something, with some
// exit code), or it could not be run at all. Collapsing the second into
// "exit code 1" is what hid the fact that `bb` is not on PATH in the process
// a plugin's server code runs in — every `bb tasks` call looked like an
// ordinary refusal, and callers are entitled to treat a refusal as "nothing
// to do". See src/core/bb-cli-path.ts.

export type CliRun =
  | { kind: "ran"; code: number; stdout: string; stderr: string }
  | { kind: "unavailable"; reason: string };

/** The single effect port: run `bb` with argv and return the outcome. Does not throw, on a non-zero code or on a failure to spawn. */
export interface CliPorts {
  run(args: readonly string[]): Promise<CliRun>;
}

export function cliRunMessage(run: CliRun): string {
  if (run.kind === "unavailable") return run.reason;
  const text = run.stderr.trim() || run.stdout.trim();
  return text === "" ? `code ${run.code}` : text;
}
