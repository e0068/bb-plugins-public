// Layer 1 — names the commit and the pull request the plugin creates.
//
// The plugin squashes the branch into a single commit made through the API,
// and one string becomes both that commit's message and the PR's title. The
// sources are ranked by how well they name the WORK rather than the
// mechanics of the branch: a linked task names it best (and carries a key
// that leads back to the board), the thread's own name next, a lone commit's
// subject after that, and the `bb/thr_…` branch only when nothing else says
// anything.

export interface TitleSources {
  /** The task linked to the thread, if Tasks+ knows one. */
  task: { key: string; title: string } | null;
  /** The thread's name as bb shows it — its title, or the fallback excerpt. */
  threadName: string | null;
  /** Subjects of the branch's own commits, in order. */
  commitSubjects: readonly string[];
  /** The head branch — the last resort, always present. */
  branch: string;
}

export function choosePrTitle({
  task,
  threadName,
  commitSubjects,
  branch,
}: TitleSources): string {
  const candidates = [
    task ? `${task.key} ${task.title}` : "",
    threadName ?? "",
    // Several commits: no single subject speaks for the whole branch, so the
    // subject line would name a part and hide the rest — the branch is honest.
    commitSubjects.length === 1 ? commitSubjects[0] : "",
    branch,
  ];
  return candidates.map(oneLine).find((candidate) => candidate !== "") ?? "";
}

// A commit message's subject is a single line; a thread name or a fallback
// excerpt is not guaranteed to be one.
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
