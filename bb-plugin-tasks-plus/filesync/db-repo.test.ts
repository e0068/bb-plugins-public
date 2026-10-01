// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { renderTaskFile } from "./task-file.js";

const dbRepoPath = "./db-repo.js";
const repoPath = "./task-repo.js";
const hranaPath = "../remote/hrana.js";
const { createDbRepo } = await planned<typeof import("./db-repo.js")>(() => import(/* @vite-ignore */ dbRepoPath));
const { WriteConflict, DatabaseUnreachable, DatabaseAuthFailed } = await planned<typeof import("./task-repo.js")>(
  () => import(/* @vite-ignore */ repoPath),
);
const { createHranaClient } = await planned<typeof import("../remote/hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

type DbRepo = import("./db-repo.js").DbRepo;
type RepoState = import("./task-repo.js").RepoState;

const HOST = "board-me.turso.io";
const NO_PLACEMENT = { assignee: null, epic: null };
const content = (title: string, slug: string, key?: string) => renderTaskFile({ title, ...(key ? { key } : {}) }, slug, []);

const opened: DbRepo[] = [];
afterEach(() => {
  for (const repo of opened.splice(0)) repo.stop();
  vi.useRealTimers();
});

/** Two machines — two repositories — on one database. */
function machines(options: { onChange?: () => void; onStateChange?: (state: RepoState) => void; pollMs?: number } = {}) {
  const fake = createHranaFake();
  const { url } = fake.addDatabase(HOST, "t1");
  const open = (extra: typeof options = {}) => {
    const repo = createDbRepo(createHranaClient({ url, token: "t1", fetch: fake.fetch }), { url, ...extra });
    opened.push(repo);
    return repo;
  };
  return { fake, url, a: open(options), b: open(), open };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail("expected a refusal"),
    (error: unknown) => error,
  );
}

describe("a board kept in a database", () => {
  it("starts empty: no tasks and no board row until one is written", async () => {
    const { a } = machines();
    await a.sync();
    expect(await a.list()).toEqual([]);
    expect(await a.readBoard()).toBeNull();
    expect(a.count()).toBe(0);
  });

  it("keeps the board's name and prefix for every machine", async () => {
    const { a, b } = machines();
    await a.sync();
    await a.writeBoard({ name: "Tasks", prefix: "TSK" });
    await b.sync();
    expect(await b.readBoard()).toEqual({ name: "Tasks", prefix: "TSK" });
  });

  it("shows another machine's new task after a sync, with no git in between", async () => {
    const { a, b } = machines();
    await a.sync();
    await b.sync();
    await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow", "TSK-1") });
    expect(await b.list()).toEqual([]);
    await b.sync();
    expect((await b.list()).map((file) => [file.slug, file.task.key])).toEqual([["glow", "TSK-1"]]);
    expect(b.count()).toBe(1);
  });

  it("sees its own write at once, before any sync", async () => {
    const { a } = machines();
    await a.sync();
    await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    expect((await a.list()).map((file) => file.slug)).toEqual(["glow"]);
  });

  it("shows a rename and a removal on the other machine too", async () => {
    const { a, b } = machines();
    await a.sync();
    const first = await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    const other = await a.write({ status: "todo", slug: "dust", placement: NO_PLACEMENT, content: content("Dust", "dust") });
    await a.write({ status: "todo", slug: "shine", placement: NO_PLACEMENT, content: content("Glow", "shine"), previousPath: first.filePath, revision: first.revision ?? undefined });
    await a.remove(other.filePath, other.revision ?? undefined);
    await b.sync();
    expect((await b.list()).map((file) => file.slug)).toEqual(["shine"]);
  });
});

describe("every write is conditional", () => {
  it("of two writes from the same version, one lands and the other is a version conflict", async () => {
    const { a, b } = machines();
    await a.sync();
    const created = await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    await b.sync();
    const [seen] = await b.list();
    await a.write({ status: "in_progress", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow"), previousPath: created.filePath, revision: created.revision ?? undefined });
    const error = await rejection(
      b.write({ status: "done", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow"), previousPath: seen!.filePath, revision: seen!.revision ?? undefined }),
    );
    expect(error).toBeInstanceOf(WriteConflict);
    expect((error as { reason: string }).reason).toBe("version");
    await b.sync();
    expect((await b.list())[0]?.status).toBe("in_progress");
  });

  it("refuses a second task under a key already taken", async () => {
    const { a, b } = machines();
    await a.sync();
    await b.sync();
    await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow", "TSK-1") });
    const error = await rejection(b.write({ status: "todo", slug: "dust", placement: NO_PLACEMENT, content: content("Dust", "dust", "TSK-1") }));
    expect(error).toBeInstanceOf(WriteConflict);
    expect((error as { reason: string }).reason).toBe("key");
  });

  it("refuses a second task under a slug already taken", async () => {
    const { a, b } = machines();
    await a.sync();
    await b.sync();
    await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    const error = await rejection(b.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Other glow", "glow") }));
    expect(error).toBeInstanceOf(WriteConflict);
    expect((error as { reason: string }).reason).toBe("slug");
  });
});

describe("keeping up by polling", () => {
  it("tells onChange when a sync brought changes, and only then", async () => {
    const onChange = vi.fn();
    const { a, b } = machines({ onChange });
    await a.sync();
    await b.sync();
    onChange.mockClear();
    await a.sync();
    expect(onChange).not.toHaveBeenCalled();
    await b.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    await a.sync();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("polls every two seconds once started, and not after it is stopped", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { a, b } = machines({ onChange });
    await a.sync();
    await b.sync();
    a.start();
    await b.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await a.list()).map((file) => file.slug)).toEqual(["glow"]);
    a.stop();
    await b.write({ status: "todo", slug: "dust", placement: NO_PLACEMENT, content: content("Dust", "dust") });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("when the database cannot be reached", () => {
  async function goOffline(fake: HranaFake, repo: DbRepo) {
    fake.setOffline(true);
    for (let attempt = 0; attempt < 3; attempt += 1) await repo.sync().catch(() => undefined);
  }

  it("goes reconnecting, then offline, and tells onStateChange each time", async () => {
    const onStateChange = vi.fn();
    const { fake, a } = machines({ onStateChange });
    await a.sync();
    fake.setOffline(true);
    expect(await rejection(a.sync())).toBeInstanceOf(DatabaseUnreachable);
    expect(a.state().kind).toBe("reconnecting");
    await a.sync().catch(() => undefined);
    await a.sync().catch(() => undefined);
    expect(a.state()).toMatchObject({ kind: "offline" });
    expect(onStateChange.mock.calls.map(([state]) => (state as RepoState).kind)).toEqual(["reconnecting", "offline"]);
    fake.setOffline(false);
    await a.sync();
    expect(a.state()).toEqual({ kind: "live" });
  });

  it("keeps serving the tasks it last saw", async () => {
    const { fake, a } = machines();
    await a.sync();
    await a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") });
    await goOffline(fake, a);
    expect((await a.list()).map((file) => file.slug)).toEqual(["glow"]);
  });

  it("refuses to write while offline without going to the network", async () => {
    const { fake, a } = machines();
    await a.sync();
    await goOffline(fake, a);
    fake.setOffline(false);
    const before = fake.pipelines();
    const error = await rejection(a.write({ status: "todo", slug: "glow", placement: NO_PLACEMENT, content: content("Glow", "glow") }));
    expect(error).toBeInstanceOf(DatabaseUnreachable);
    expect(fake.pipelines()).toBe(before);
  });

  it("never shows an empty board it has not seen: the first list fails instead", async () => {
    const { fake, open } = machines();
    const fresh = open();
    fake.setOffline(true);
    expect(await rejection(fresh.list())).toBeInstanceOf(DatabaseUnreachable);
  });

  it("tells a refused token apart from a dropped network", async () => {
    const fake = createHranaFake();
    const { url } = fake.addDatabase(HOST, "t1");
    const repo = createDbRepo(createHranaClient({ url, token: "wrong", fetch: fake.fetch }), { url });
    opened.push(repo);
    expect(await rejection(repo.sync())).toBeInstanceOf(DatabaseAuthFailed);
  });
});
