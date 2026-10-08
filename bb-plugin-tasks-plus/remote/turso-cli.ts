/**
 * The turso CLI of the host — enough of it to mint a Turso API token for the
 * account its owner is logged in with, so the token does not have to be
 * found and copied by hand. Every failure is a value.
 */

/** Shape of `node:child_process`'s `execFile`, narrowed to the one overload
 *  this module calls — injected so tests never spawn a real process. */
export type CliExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

/** What one run of the CLI left behind. */
export interface CliRun {
  error: Error | null;
  stdout: string;
  stderr: string;
}

export type MintRunReading =
  | { kind: "ok"; token: string }
  | { kind: "missing" }
  | { kind: "not_logged_in" }
  | { kind: "failed"; message: string };

export type CliMintFailure = "cli_missing" | "not_logged_in" | "failed";

export type CliMintResult = { ok: true; token: string } | { ok: false; reason: CliMintFailure; message: string };

export interface CliMintDeps {
  execFile: CliExecFile;
  /** Binary paths, tried in order until one exists. */
  candidates: readonly string[];
  now: Date;
}

const TOKEN_NAME_PREFIX = "bb-tasks-plus-";
const RUN_TIMEOUT_MS = 20_000;
const MINT_ARGS = ["auth", "api-tokens", "mint"] as const;
const MINT_FAILED = "turso auth api-tokens mint failed";
const ANSI = /\u001b\[[0-9;]*m/g;

/** The PATH first, then where Homebrew, a manual install and the Turso installer put the binary. */
export function tursoCliCandidates(home: string): string[] {
  return ["turso", "/opt/homebrew/bin/turso", "/usr/local/bin/turso", `${home}/.turso/turso`];
}

/** A token name unique to the UTC second, so tokens of the account never clash. */
export function cliTokenName(now: Date): string {
  return `${TOKEN_NAME_PREFIX}${now.toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

const lines = (text: string): string[] =>
  text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const isMissing = (error: Error | null): boolean =>
  error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";

const wasKilled = (error: Error | null): boolean =>
  error !== null && "killed" in error && (error as { killed?: unknown }).killed === true;

/** The first words of a refusal, without the `Error:` the CLI prefixes;
 *  stderr first, then stdout — some refusals of the CLI go to stdout. */
const refusal = (run: CliRun): string =>
  [...lines(run.stderr), ...lines(run.stdout)][0]?.replace(/^Error:\s*/, "") ?? MINT_FAILED;

/** The CLI prints its "not logged in" to stderr or, as v1.0.33 does, to stdout
 *  exiting 0 — so this check comes before the split by exit code. */
const isNotLoggedIn = (run: CliRun): boolean => /not logged in/i.test(`${run.stderr}\n${run.stdout}`);

/** A token is one word on the last printed line; anything else is a refusal. */
function printedToken(run: CliRun): MintRunReading {
  const last = lines(run.stdout).at(-1);
  return last !== undefined && !/\s/.test(last) ? { kind: "ok", token: last } : { kind: "failed", message: refusal(run) };
}

export function readMintRun(run: CliRun): MintRunReading {
  if (isMissing(run.error)) return { kind: "missing" };
  if (wasKilled(run.error)) return { kind: "failed", message: `The turso CLI did not answer in ${RUN_TIMEOUT_MS / 1000} s.` };
  if (isNotLoggedIn(run)) return { kind: "not_logged_in" };
  return run.error === null ? printedToken(run) : { kind: "failed", message: refusal(run) };
}

const runMint = (execFile: CliExecFile, file: string, name: string): Promise<CliRun> =>
  new Promise((resolve) => {
    execFile(file, [...MINT_ARGS, name], { timeout: RUN_TIMEOUT_MS }, (error, stdout, stderr) =>
      resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }),
    );
  });

function toResult(reading: Exclude<MintRunReading, { kind: "missing" }>): CliMintResult {
  switch (reading.kind) {
    case "ok":
      return { ok: true, token: reading.token };
    case "not_logged_in":
      return { ok: false, reason: "not_logged_in", message: "The turso CLI is not logged in." };
    case "failed":
      return { ok: false, reason: "failed", message: reading.message };
  }
}

/** Mints an API token with the first turso binary that exists; none exists — `cli_missing`. */
export async function mintCliApiToken(deps: CliMintDeps): Promise<CliMintResult> {
  const name = cliTokenName(deps.now);
  for (const file of deps.candidates) {
    const reading = readMintRun(await runMint(deps.execFile, file, name));
    if (reading.kind !== "missing") return toResult(reading);
  }
  return { ok: false, reason: "cli_missing", message: "The turso CLI is not installed on this machine." };
}
