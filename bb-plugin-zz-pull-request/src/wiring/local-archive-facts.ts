// Layer 3 (shell), the testable part — measures the two facts the archive
// decision needs using ONLY the working copy on disk, without asking bb.
//
// It exists for the environment bb won't talk about: `environments.status`
// and `environments.pullRequest` go through `requireReadyEnvironment` and
// throw for anything but `ready`, so a thread whose environment is `retiring`
// gets no answer at all — and the button used to read that silence as
// "not merged" and vanish. A retiring environment is one step BEFORE
// `destroying`, so its working copy is still on disk and git can be asked
// directly.
//
// The sequence is verified with a fake `run`, no real git; the actual process
// is spawned by git-client.ts.
import type { ArchiveReadinessInput, Landing } from "../core/archive-readiness";
import { headShaArgs } from "../core/git-commands";
import type { MergedContent } from "../core/merged-content";
import { decideWorkingTree, workingTreeStatusArgs } from "../core/working-tree";
import { measureContentCached, type ContentCachePorts } from "./content-cache";
import type { GitPorts } from "./git-run";

/** The shared measure-once-per-HEAD protocol, plus the git this button runs itself. */
export interface ArchiveFactsPorts extends ContentCachePorts {
  git: GitPorts;
}

const UNMEASURED = { landing: "unknown", workingTree: "unknown" } as const;

export async function measureArchiveFacts(
  ports: ArchiveFactsPorts,
): Promise<ArchiveReadinessInput> {
  // Reading HEAD is local and instant, and it is what keys the shared cache —
  // so the expensive measurement behind `measure` is skipped for a HEAD
  // already recorded as landed. See content-cache.ts.
  const landing = landingOf(await measureContentCached(ports, await readHeadSha(ports.git)));
  // Cheap-first, and it mirrors decideArchiveVisible's own order: a landing
  // that already hides the button makes the tree irrelevant, so don't spawn a
  // second git for an answer nobody will read.
  if (landing !== "landed") return { ...UNMEASURED, landing };
  return {
    landing,
    workingTree: decideWorkingTree(await ports.git.run(workingTreeStatusArgs())),
  };
}

// `null` rather than a guess: an unreadable HEAD only costs the cache, and the
// measurement below answers on its own either way.
async function readHeadSha(git: GitPorts): Promise<string | null> {
  const run = await git.run(headShaArgs());
  return run.code === 0 ? run.stdout.trim() || null : null;
}

// "unlanded-commits" is unreachable here, and that is not an omission: it
// means "the work landed AND new commits piled on top", which by construction
// cannot coexist with a `merged` content verdict — if merging the branch into
// the base would add nothing, there is nothing sitting on top.
function landingOf(content: MergedContent): Landing {
  switch (content) {
    case "merged":
      return "landed";
    case "not-merged":
      return "not-merged";
    case "unknown":
      return "unknown";
  }
}
