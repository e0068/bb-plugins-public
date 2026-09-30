import { describe, expect, it } from "vitest";
import { bumpVersionsBeforeMerge } from "./merge-time-bump";
import { encodeBase64 } from "../core/base64";
import type { GithubRequest, RepoRef } from "../core/github-requests";
import type { CreatePrPorts, GithubResponse } from "./create-pr";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };
const input = { repo, baseBranch: "main", headBranch: "bb/thr_x", pullNumber: 42, level: "patch" } as const;

interface WorldFile {
  /** package.json / package-lock.json text at a ref, keyed `<ref>:<path>`. */
  [key: string]: string;
}

interface World {
  behindBy: number;
  changedPaths: string[];
  files: WorldFile;
  /** HTTP status for the update-branch call; 202 is GitHub's success. */
  updateBranchStatus?: number;
  compareStatus?: number;
  /** The PR's title as GitHub answers it; absent — the PR cannot be read (404). */
  pullTitle?: string;
}

function fakeGithub(world: World): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  const ports: CreatePrPorts = {
    async send(req: GithubRequest): Promise<GithubResponse> {
      calls.push(req);
      if (req.path.includes("/compare/")) {
        const status = world.compareStatus ?? 200;
        return {
          status,
          data:
            status === 200
              ? { behind_by: world.behindBy, files: world.changedPaths.map((filename) => ({ filename })) }
              : { message: "Not Found" },
        };
      }
      if (req.path.endsWith("/update-branch")) {
        return { status: world.updateBranchStatus ?? 202, data: { message: "merge conflict" } };
      }
      if (req.path.includes("/contents/")) {
        const [, path, ref] = /\/contents\/(.+)\?ref=(.+)$/.exec(req.path) as RegExpExecArray;
        const text = world.files[`${decodeURIComponent(ref)}:${decodeURIComponent(path)}`];
        return text === undefined
          ? { status: 404, data: { message: "Not Found" } }
          : { status: 200, data: { encoding: "base64", content: encodeBase64(text) } };
      }
      if (req.method === "GET" && req.path.endsWith(`/pulls/${input.pullNumber}`)) {
        return world.pullTitle === undefined
          ? { status: 404, data: { message: "Not Found" } }
          : { status: 200, data: { number: input.pullNumber, title: world.pullTitle } };
      }
      if (req.path.includes("/branches/")) {
        return { status: 200, data: { commit: { sha: "headsha" } } };
      }
      if (req.path.endsWith("/git/commits") && req.method === "POST") {
        return { status: 201, data: { sha: "bumpsha" } };
      }
      if (req.path.includes("/git/commits/")) {
        return { status: 200, data: { tree: { sha: "headtree" } } };
      }
      if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: `blob${calls.length}` } };
      if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "newtree" } };
      if (req.path.includes("/git/refs/")) return { status: 200, data: {} };
      throw new Error(`unexpected request ${req.method} ${req.path}`);
    },
  };
  return { ports, calls };
}

const pkg = (version: string): string =>
  `${JSON.stringify({ name: "bb-plugin-x", version }, null, 2)}\n`;

const lock = (version: string): string =>
  `${JSON.stringify(
    { name: "bb-plugin-x", version, lockfileVersion: 3, packages: { "": { name: "bb-plugin-x", version } } },
    null,
    2,
  )}\n`;

function bodyOf(calls: readonly GithubRequest[], suffix: string): Record<string, unknown> {
  const call = calls.find((c) => c.path.endsWith(suffix) && c.method === "POST");
  return (call?.body ?? {}) as Record<string, unknown>;
}

describe("bumpVersionsBeforeMerge", () => {
  it("the PR touches no plugin at all → nothing read, nothing written", async () => {
    const { ports, calls } = fakeGithub({ behindBy: 0, changedPaths: ["docs/INDEX.md"], files: {} });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["docs/INDEX.md"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("the branch already carries a higher version → left alone, no commit", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("the base moved past the branch → a commit setting the version one past the BASE", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/package.json"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
      },
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/package.json"],
      bumped: [{ root: "bb-plugin-x", to: "0.2.13" }],
      problems: [],
      headMoved: true,
    });
    expect(bodyOf(calls, "/git/blobs").content).toContain(`"version": "0.2.13"`);
    expect(bodyOf(calls, "/git/commits")).toMatchObject({
      tree: "newtree",
      parents: ["headsha"],
    });
    expect(calls.some((c) => c.method === "PATCH" && c.path.includes("/git/refs/heads/bb/thr_x"))).toBe(true);
  });

  it("a package-lock.json alongside it follows to the very same version", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/server.ts"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-x/package-lock.json": lock("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    await bumpVersionsBeforeMerge(ports, input);
    const written = calls
      .filter((c) => c.path.endsWith("/git/blobs"))
      .map((c) => (c.body as { content: string }).content);
    expect(written).toHaveLength(2);
    expect(written.every((content) => content.includes(`"version": "0.2.12"`))).toBe(true);
  });

  it("the branch is behind the base → it is caught up first, pinned to the head we measured", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 4,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report.bumped).toEqual([{ root: "bb-plugin-x", to: "0.2.12" }]);
    expect(report.headMoved).toBe(true);
    const update = calls.find((c) => c.path.endsWith("/update-branch"));
    expect(update).toMatchObject({ method: "PUT", body: { expected_head_sha: "headsha" } });
    // The bump must be computed from the caught-up head: the package.json
    // read that feeds the commit comes AFTER the update-branch call.
    const reads = calls.map((c) => c.path.includes("/contents/"));
    expect(calls.indexOf(update as GithubRequest)).toBeLessThan(reads.lastIndexOf(true));
  });

  // Catching up rewrites the PR's head, and GitHub then recomputes its
  // mergeability — a merge fired in that window fails. Paying that price
  // when there is nothing to bump (the version already grew on an earlier
  // press) turned every retry of the Merge button into another rewrite.
  it("already ahead and behind the base → no catch-up, the head is left alone", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 4,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls.some((c) => c.path.endsWith("/update-branch"))).toBe(false);
    expect(calls.some((c) => c.path.includes("/git/"))).toBe(false);
  });

  it("catching up fails (a real conflict) → said out loud, and nothing is committed on top of it", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 4,
      updateBranchStatus: 422,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report.bumped).toEqual([]);
    expect(report.problems).toEqual([
      "could not catch bb/thr_x up with main before bumping versions (HTTP 422: merge conflict)",
    ]);
    expect(report.headMoved).toBe(false);
    expect(calls.some((c) => c.path.includes("/git/blobs"))).toBe(false);
  });

  it("сравнение не прошло → это названо, а не прочитано как «ничего не изменилось»", async () => {
    const { ports } = fakeGithub({ behindBy: 0, compareStatus: 500, changedPaths: [], files: {} });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report.bumped).toEqual([]);
    expect(report.changedPaths).toEqual([]);
    expect(report.headMoved).toBe(false);
    expect(report.problems).toEqual(["could not compare bb/thr_x with main (HTTP 500)"]);
    expect(report.gap ?? null).toBeNull();
  });

  it("сравнения нет, потому что ветки нет на origin — это пробел, а не поломка", async () => {
    const { ports } = fakeGithub({ behindBy: 0, compareStatus: 404, changedPaths: [], files: {} });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report.problems).toEqual(["could not compare bb/thr_x with main (HTTP 404)"]);
    expect(report.gap).toBe("branch-not-published");
  });

  it("a touched root with no package.json anywhere is not a versioned root, and not a problem", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["packages/plugin-base/tsconfig.json"],
      files: {},
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["packages/plugin-base/tsconfig.json"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a version nobody can reason about is a problem, not a silent skip", async () => {
    const { ports } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("1.0.0-rc.1"),
        "main:bb-plugin-x/package.json": pkg("0.9.9"),
      },
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx"],
      bumped: [],
      problems: ["bb-plugin-x: no readable version on the branch"],
      headMoved: false,
    });
  });

  it("several touched plugins are each bumped against their own base version", async () => {
    const { ports } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-y/server.ts"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-y/package.json": pkg("1.4.0"),
        "main:bb-plugin-y/package.json": pkg("1.4.7"),
      },
    });
    expect((await bumpVersionsBeforeMerge(ports, input)).bumped).toEqual([
      { root: "bb-plugin-x", to: "0.2.12" },
      { root: "bb-plugin-y", to: "1.4.8" },
    ]);
  });
});

describe("bumpVersionsBeforeMerge — разряд из тега", () => {
  const world = () => ({
    behindBy: 0,
    changedPaths: ["bb-plugin-x/app.tsx"],
    files: {
      "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
      "bb/thr_x:bb-plugin-x/package-lock.json": lock("0.2.12"),
      "main:bb-plugin-x/package.json": pkg("0.2.11"),
      "main:bb-plugin-x/package-lock.json": lock("0.2.11"),
    },
  });

  it("major: the branch is committed onto the base's next major", async () => {
    const { ports, calls } = fakeGithub(world());
    const report = await bumpVersionsBeforeMerge(ports, { ...input, level: "major" });
    expect(report.bumped).toEqual([{ root: "bb-plugin-x", to: "1.0.0" }]);
    expect(report.headMoved).toBe(true);
    expect(bodyOf(calls, "/git/blobs").content).toContain(`"version": "1.0.0"`);
  });

  it("minor: the branch is committed onto the base's next minor", async () => {
    const { ports } = fakeGithub(world());
    expect((await bumpVersionsBeforeMerge(ports, { ...input, level: "minor" })).bumped).toEqual([
      { root: "bb-plugin-x", to: "0.3.0" },
    ]);
  });

  it("patch on the same pair: the branch is already ahead, nothing is committed", async () => {
    const { ports, calls } = fakeGithub(world());
    const report = await bumpVersionsBeforeMerge(ports, { ...input, level: "patch" });
    expect(report.bumped).toEqual([]);
    expect(report.headMoved).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("package-lock.json follows the very version package.json landed on", async () => {
    const { ports, calls } = fakeGithub(world());
    await bumpVersionsBeforeMerge(ports, { ...input, level: "major" });
    const blobs = calls.filter((c) => c.path.endsWith("/git/blobs")).map((c) => JSON.stringify(c.body));
    expect(blobs.filter((body) => body.includes("1.0.0"))).toHaveLength(2);
  });
});

/** What the bump commit wrote: path → text, read off the tree request and the blobs it points at. */
function committedFiles(calls: readonly GithubRequest[]): Record<string, string> {
  const blobs = new Map<string, string>(calls.flatMap((c, i) => (c.path.endsWith("/git/blobs") ? [[`blob${i + 1}`, String((c.body as { content: string }).content)] as const] : [])));
  const tree = (bodyOf(calls, "/git/trees").tree ?? []) as { path: string; sha: string }[];
  return Object.fromEntries(tree.map((entry) => [entry.path, blobs.get(entry.sha) ?? ""]));
}

describe("bumpVersionsBeforeMerge — ченж-лог", () => {
  const dated = { ...input, changelogDate: "2026-09-30" };
  const notes = "- ru: Новая кнопка\n  en: A new button\n";
  const comingSoon = `---\nversion: coming-soon\n---\n\n${notes}`;
  const stamped = (version: string, date = "2026-09-30", pull = 42) => `---\nversion: ${version}\ndate: ${date}\npr: ${pull}\n---\n\n${notes}`;
  const history = "---\nversion: 0.2.10\ndate: 2026-09-01\n---\n\n- ru: Старое\n  en: Old\n";

  it("the version is raised → the PR's coming-soon entry gets that version, the date and the PR in the same commit", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": comingSoon,
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report.bumped).toEqual([{ root: "bb-plugin-x", to: "0.2.13" }]);
    expect(report.problems).toEqual([]);
    expect(committedFiles(calls)["bb-plugin-x/changelog/new-button.md"]).toBe(stamped("0.2.13"));
  });

  it("the PR wrote no entry → pr-<number>.md carries the PR title as the entry of the new version", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
      },
      pullTitle: "X — новая кнопка",
    });
    await bumpVersionsBeforeMerge(ports, dated);
    expect(committedFiles(calls)["bb-plugin-x/changelog/pr-42.md"]).toBe(
      "---\nversion: 0.2.13\ndate: 2026-09-30\npr: 42\n---\n\n- ru: X — новая кнопка\n  en: X — новая кнопка\n",
    );
  });

  it("the branch is already ahead → the entry gets the branch's own version, and only the entry is committed", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": comingSoon,
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report.bumped).toEqual([]);
    expect(report.headMoved).toBe(true);
    expect(committedFiles(calls)).toEqual({ "bb-plugin-x/changelog/new-button.md": stamped("0.2.12") });
  });

  it("a second run over an entry already stamped by this PR with the same version and date commits nothing", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/package.json", "bb-plugin-x/changelog/pr-42.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-x/changelog/pr-42.md": stamped("0.2.12"),
      },
      pullTitle: "X — новая кнопка",
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report.headMoved).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a neighbour took the version this PR stamped → its entry moves to the new version and the merge day", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": stamped("0.2.12", "2026-09-28"),
      },
    });
    await bumpVersionsBeforeMerge(ports, dated);
    expect(committedFiles(calls)["bb-plugin-x/changelog/new-button.md"]).toBe(stamped("0.2.13"));
  });

  it("history files a PR adds next to its code keep their versions: without a PR of their own they are never restamped", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/0.2.10.md", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
        "bb/thr_x:bb-plugin-x/changelog/0.2.10.md": history,
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": comingSoon,
      },
    });
    await bumpVersionsBeforeMerge(ports, dated);
    expect(Object.keys(committedFiles(calls)).sort()).toEqual(["bb-plugin-x/changelog/new-button.md", "bb-plugin-x/package.json"]);
  });

  it("a PR that only touches the changelog raises no version and writes no entry", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/changelog/0.2.10.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
        "bb/thr_x:bb-plugin-x/changelog/0.2.10.md": history,
      },
      pullTitle: "X — поправить историю",
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report).toEqual({ changedPaths: ["bb-plugin-x/changelog/0.2.10.md"], bumped: [], problems: [], headMoved: false });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("the fallback of an earlier run gives way once the PR carries its own entry", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/pr-42.md", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-x/changelog/pr-42.md": "---\nversion: 0.2.12\ndate: 2026-09-30\npr: 42\n---\n\n- ru: X — новая кнопка\n  en: X — новая кнопка\n",
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": comingSoon,
      },
    });
    await bumpVersionsBeforeMerge(ports, dated);
    const tree = (bodyOf(calls, "/git/trees").tree ?? []) as { path: string; sha: string | null }[];
    expect(tree.find((entry) => entry.path === "bb-plugin-x/changelog/pr-42.md")?.sha).toBeNull();
    expect(committedFiles(calls)["bb-plugin-x/changelog/new-button.md"]).toBe(stamped("0.2.12"));
  });

  it("a commit that only stamps entries names the changelog, not an empty version list", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": comingSoon,
      },
    });
    await bumpVersionsBeforeMerge(ports, dated);
    expect(bodyOf(calls, "/git/commits").message).toBe("chore(changelog): bb-plugin-x");
  });

  it("a shared package keeps no changelog: no entry is written and the PR is not read", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["packages/x/index.ts"],
      files: {
        "bb/thr_x:packages/x/package.json": pkg("0.2.11"),
        "main:packages/x/package.json": pkg("0.2.12"),
      },
    });
    await bumpVersionsBeforeMerge(ports, dated);
    expect(Object.keys(committedFiles(calls))).toEqual(["packages/x/package.json"]);
    expect(calls.some((c) => c.path.endsWith("/pulls/42"))).toBe(false);
  });

  it("the PR title cannot be read → said out loud, the version is still raised, no entry is invented", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report.bumped).toEqual([{ root: "bb-plugin-x", to: "0.2.13" }]);
    expect(report.problems.join(" ")).toContain("bb-plugin-x: no changelog entry");
    expect(Object.keys(committedFiles(calls))).toEqual(["bb-plugin-x/package.json"]);
  });

  it("an entry file without a header is named as a problem and left as written", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": notes,
      },
      pullTitle: "X — новая кнопка",
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report.problems.join(" ")).toContain("bb-plugin-x/changelog/new-button.md");
    expect(committedFiles(calls)["bb-plugin-x/changelog/new-button.md"]).toBeUndefined();
  });

  it("an entry the PR deleted is not resurrected", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/changelog/old.md", "bb-plugin-x/changelog/new-button.md"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
        "bb/thr_x:bb-plugin-x/changelog/new-button.md": comingSoon,
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, dated);
    expect(report.problems).toEqual([]);
    expect(Object.keys(committedFiles(calls)).sort()).toEqual(["bb-plugin-x/changelog/new-button.md", "bb-plugin-x/package.json"]);
  });
});
