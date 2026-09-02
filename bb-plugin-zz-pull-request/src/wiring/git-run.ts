// Layer 3 (shell) — the shared effect port for running git and parsing its
// output into a readable message. Used by all of the plugin's git-command
// orchestrators (fast-forward.ts, local-main-pull.ts); the actual process is
// spawned by git-client.ts.

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** The single effect port: run git with argv and return its code and output. Does not throw on a non-zero code. */
export interface GitPorts {
  run(args: readonly string[]): Promise<GitRun>;
}

export function gitRunMessage(run: GitRun): string {
  const text = run.stderr.trim() || run.stdout.trim();
  return text === "" ? `code ${run.code}` : text;
}
