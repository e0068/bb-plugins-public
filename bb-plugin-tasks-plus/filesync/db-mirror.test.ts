import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { rootOfTaskFile } from "./fs-repo.js";
import { renderTaskFile } from "./task-file.js";

const mirrorPath = "./db-mirror.js";
const { rowToRepoFile, applyRows, taskFilePath, nextLink, INITIAL_LINK } = await planned<typeof import("./db-mirror.js")>(
  () => import(/* @vite-ignore */ mirrorPath),
);

type TaskRow = import("./db-mirror.js").TaskRow;

const URL_ = "libsql://board-me.turso.io";

function row(slug: string, patch: Partial<TaskRow> = {}): TaskRow {
  return {
    slug,
    key: null,
    status: "todo",
    assignee: null,
    epic: null,
    content: renderTaskFile({ title: slug.toUpperCase() }, slug, []),
    version: 1,
    seq: 1,
    deleted: 0,
    created_at: "2026-09-30T10:00:00.000Z",
    updated_at: "2026-09-30T11:00:00.000Z",
    ...patch,
  };
}

const rowArb = fc
  .record({
    slug: fc.constantFrom("a", "b", "c"),
    status: fc.constantFrom("backlog", "todo", "in_progress", "done"),
    version: fc.integer({ min: 1, max: 5 }),
    seq: fc.integer({ min: 1, max: 50 }),
    deleted: fc.constantFrom(0, 1),
  })
  .map(({ slug, ...patch }) => row(slug, patch));

describe("a database row read as a task file", () => {
  it("parses the text the row holds and takes status, placement, times and version from the columns", () => {
    const file = rowToRepoFile(URL_, row("glow", { status: "in_progress", assignee: "Claude", version: 7 }));
    expect(file).toMatchObject({
      slug: "glow",
      status: "in_progress",
      assignee: "Claude",
      epic: null,
      revision: 7,
      createdAt: "2026-09-30T10:00:00.000Z",
      updatedAt: "2026-09-30T11:00:00.000Z",
      task: { title: "GLOW" },
    });
  });

  it("lives at a path the store can turn back into the board's address", () => {
    const placements = [
      { assignee: null, epic: null },
      { assignee: "Claude", epic: null },
      { assignee: "Claude", epic: "Launch" },
    ];
    for (const placement of placements) {
      const path = taskFilePath(URL_, { status: "todo", slug: "glow", ...placement });
      expect(path.endsWith("/todo/glow.md")).toBe(true);
      expect(rootOfTaskFile(path, placement)).toBe(URL_);
    }
  });

  it("skips a row whose status the board does not know", () => {
    expect(rowToRepoFile(URL_, row("glow", { status: "someday" }))).toBeNull();
  });
});

describe("the mirror catching up with changed rows", () => {
  it("drops deleted rows and keeps the rest by slug", () => {
    const mirror = applyRows(new Map(), URL_, [row("a"), row("b"), row("b", { deleted: 1, seq: 2 })]);
    expect([...mirror.keys()]).toEqual(["a"]);
  });

  it("lets the later change of a row win, whatever order the rows come in", () => {
    fc.assert(
      fc.property(fc.uniqueArray(rowArb, { selector: (r) => r.seq, maxLength: 12 }), (rows) => {
        const sorted = [...rows].sort((x, y) => x.seq - y.seq);
        const shuffled = [...rows].reverse();
        const bySeq = applyRows(new Map(), URL_, sorted);
        const byOther = applyRows(new Map(), URL_, shuffled);
        const latest = new Map<string, TaskRow>();
        for (const r of sorted) if ((latest.get(r.slug)?.seq ?? -1) <= r.seq) latest.set(r.slug, r);
        const alive = [...latest.values()].filter((r) => r.deleted === 0 && rowToRepoFile(URL_, r) !== null).map((r) => r.slug).sort();
        expect([...bySeq.keys()].sort()).toEqual(alive);
        expect([...byOther.keys()].sort()).toEqual(alive);
      }),
    );
  });

  it("applying the same changes twice changes nothing more", () => {
    fc.assert(
      fc.property(fc.uniqueArray(rowArb, { selector: (r) => r.seq, maxLength: 12 }), (rows) => {
        const once = applyRows(new Map(), URL_, rows);
        const twice = applyRows(once, URL_, rows);
        expect([...twice.entries()]).toEqual([...once.entries()]);
      }),
    );
  });

  it("leaves the mirror it was given untouched", () => {
    const before = applyRows(new Map(), URL_, [row("a")]);
    applyRows(before, URL_, [row("a", { deleted: 1, seq: 2 })]);
    expect([...before.keys()]).toEqual(["a"]);
  });
});

describe("the link to the database", () => {
  const ok = (at: string) => ({ ok: true, at });
  const fail = (at: string) => ({ ok: false, at });

  it("goes reconnecting on the first failure and offline on the third in a row", () => {
    const first = nextLink(nextLink(INITIAL_LINK, ok("t0")), fail("t1"));
    expect(first.state).toEqual({ kind: "reconnecting", since: "t1" });
    const second = nextLink(first, fail("t2"));
    expect(second.state).toEqual({ kind: "reconnecting", since: "t1" });
    const third = nextLink(second, fail("t3"));
    expect(third.state).toEqual({ kind: "offline", since: "t3", lastSyncAt: "t0" });
  });

  it("is live again on the first success, whatever came before", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 10 }), (outcomes) => {
        const link = outcomes.reduce((acc, success, index) => nextLink(acc, { ok: success, at: `t${index}` }), INITIAL_LINK);
        const after = nextLink(link, ok("done"));
        expect(after.state).toEqual({ kind: "live" });
        expect(after.lastSyncAt).toBe("done");
      }),
    );
  });

  it("is offline exactly when the last three attempts failed", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), (outcomes) => {
        const link = outcomes.reduce((acc, success, index) => nextLink(acc, { ok: success, at: `t${index}` }), INITIAL_LINK);
        const tail = outcomes.slice(-3);
        const offline = tail.length === 3 && tail.every((success) => !success);
        expect(link.state.kind === "offline").toBe(offline);
      }),
    );
  });

  it("remembers no sync before the first success", () => {
    expect(INITIAL_LINK.lastSyncAt).toBeNull();
    expect(nextLink(nextLink(nextLink(INITIAL_LINK, fail("a")), fail("b")), fail("c")).state).toEqual({ kind: "offline", since: "c", lastSyncAt: null });
  });
});
