// Refreshes vendor/ — the copy of Shapeshift's link icons stylesheet — from a
// commit of a Shapeshift checkout.
//
//   npm run update [-- [--from <checkout>] [--ref <commit or branch>]]
//
// The file is read out of git at the ref, not off the disk, so the commit in
// manifest.json always describes the copy. manifest.json also holds the sha256
// of the file, which is what the integrity test holds the copy to: the copy is
// never edited, only refreshed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Where the stylesheet lives in Shapeshift, and its name in the copy. */
export const SOURCE = "src/2-functions/link-icons.css";
export const FILE = "link-icons.css";
export const MANIFEST = "manifest.json";

export const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const manifestOf = (commit, text) => ({ source: "Shapeshift", path: SOURCE, commit, files: { [FILE]: hashOf(text) } });

const USAGE = "usage: npm run update [-- [--from <checkout>] [--ref <commit or branch>]]";

function fail(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? fail(`${name} needs a value.`) : value;
}

function main() {
  const from = argument("--from", join(homedir(), "Documents", "Projects", "Shapeshift"));
  const ref = argument("--ref", "main");
  const git = (...args) => {
    try {
      return execFileSync("git", ["-C", from, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      return fail(`git ${args.join(" ")} failed in ${from}: ${String(error.stderr ?? error.message).trim()}`);
    }
  };
  const commit = git("rev-parse", `${ref}^{commit}`).trim();
  const text = git("show", `${commit}:${SOURCE}`);
  const to = fileURLToPath(new URL("./vendor/", import.meta.url));
  mkdirSync(to, { recursive: true });
  writeFileSync(join(to, FILE), text);
  writeFileSync(join(to, MANIFEST), `${JSON.stringify(manifestOf(commit, text), null, 2)}\n`);
  console.log(`vendor/${FILE} is at Shapeshift ${commit.slice(0, 8)}.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
