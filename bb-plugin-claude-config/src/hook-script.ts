// Layer 1 — extracting the path of the file a hook command reads or runs.
// A pure function with no I/O: input is the command, output is a path
// token (possibly with placeholders like `$CLAUDE_PROJECT_DIR` or `~`).
// Resolving placeholders and reading the file is the I/O layer's (server)
// concern, not this module's.

/**
 * Pulls the path of the file a hook command reads or runs out of the
 * command (`cat .../checklist.json`, `bash .../foo.sh`, a direct
 * `~/.claude/hooks/x.py`), or null if there's no file argument
 * (`jq -r '.foo'`, `echo hi`).
 *
 * Parsing is coarse and lenient: the command is split on whitespace, quotes
 * are stripped, and the first token containing a `/` path separator is
 * taken as the file — this way the utility name (`cat`, `bash`), flags, and
 * jq filters (`.tool_input.command`) drop out on their own, while absolute,
 * `~`- and `$VAR`-prefixed file paths are recognized. Environment
 * placeholders are left in the path as-is — the I/O layer expands them.
 */
export function extractCommandFile(command: string): string | null {
  for (const rawToken of command.split(/\s+/)) {
    const token = stripQuotes(rawToken);
    if (token === "" || token.startsWith("-")) continue;
    if (token.includes("/")) return token;
  }
  return null;
}

/** Strips surrounding single or double quotes from a token. */
function stripQuotes(token: string): string {
  const match = /^(['"])(.*)\1$/.exec(token);
  return match ? match[2] : token;
}
