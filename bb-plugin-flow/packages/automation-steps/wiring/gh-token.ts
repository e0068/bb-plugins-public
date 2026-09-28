// Layer 3 — effect point: read the token from an authorized `gh` on the bb
// machine. `gh auth token` prints a valid bearer token for api.github.com,
// so a PR can be opened without a personal token in settings. Errors (no gh /
// not logged in) are swallowed into null — the caller turns that into a
// readable message for the user.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function ghAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5000 });
    const token = stdout.trim();
    return token === "" ? null : token;
  } catch {
    return null;
  }
}
