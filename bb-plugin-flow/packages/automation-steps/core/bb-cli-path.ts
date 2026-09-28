// Layer 1 — which file to spawn for the `bb` CLI, derived from the
// environment alone. Pure: the environment is an argument, not something
// read from the process here; the actual spawn is in
// src/wiring/bb-cli-client.ts.
//
// Why this exists at all: `bb` is NOT on PATH for the process a plugin's
// server code runs in. The binary lives inside the app bundle
// (…/bb-app/host-daemon/dist/bb), and the server process's PATH is the
// GUI-launched one — /opt/homebrew/bin, /usr/local/bin, /usr/bin, … — with
// no entry pointing there. A plain `execFile("bb", …)` therefore fails with
// ENOENT, which is exactly how every `bb tasks` call from this plugin died
// silently. bb does export its own location in the environment, so that's
// what we spawn.
import { join } from "node:path";

export interface BbCliEnv {
  /** Absolute path of the `bb` executable, exported by the bb server process. */
  BB_CLI?: string | undefined;
  /** Directory holding it, exported by both the server and the host daemon. */
  BB_CLI_DIR?: string | undefined;
}

/**
 * The executable to spawn: the explicitly named binary, else the `bb` inside
 * the exported CLI directory, else the bare name for PATH lookup. A blank
 * value counts as absent — an empty `BB_CLI` must not turn into a spawn of
 * "", which fails with a far less obvious error than "not found on PATH".
 */
export function bbExecutable(env: BbCliEnv): string {
  const named = trimmed(env.BB_CLI);
  if (named) return named;

  const dir = trimmed(env.BB_CLI_DIR);
  return dir ? join(dir, "bb") : "bb";
}

function trimmed(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}
