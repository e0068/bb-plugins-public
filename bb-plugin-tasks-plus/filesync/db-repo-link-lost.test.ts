// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake } from "../test-support/hrana-fake.js";

const dbRepoPath = "./db-repo.js";
const hranaPath = "../remote/hrana.js";
const { createDbRepo } = await planned<typeof import("./db-repo.js")>(() => import(/* @vite-ignore */ dbRepoPath));
const { createHranaClient } = await planned<typeof import("../remote/hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

type DbRepo = import("./db-repo.js").DbRepo;
type UnreachableCause = import("../remote/hrana.js").UnreachableCause;

const opened: DbRepo[] = [];
afterEach(() => {
  for (const repo of opened.splice(0)) repo.stop();
});

function board() {
  const fake = createHranaFake();
  const { url } = fake.addDatabase("board-me.turso.io", "t1");
  const told: UnreachableCause[] = [];
  const repo = createDbRepo(createHranaClient({ url, token: "t1", fetch: fake.fetch }), { url, onLinkLost: (why) => told.push(why) });
  opened.push(repo);
  return { fake, repo, told };
}

const settle = (promise: Promise<unknown>) => promise.then(() => undefined, () => undefined);

describe("telling that the link to the database is lost", () => {
  it("tells the first failure after a live link, with its cause, and not the same cause again", async () => {
    const { fake, repo, told } = board();
    fake.respondWith(503);
    await settle(repo.sync());
    await settle(repo.sync());
    await settle(repo.sync());
    expect(told).toEqual([{ cause: "http", status: 503, detail: "unavailable" }]);
  });

  it("tells again when the cause changes while the link is down", async () => {
    const { fake, repo, told } = board();
    fake.respondWith(503);
    await settle(repo.sync());
    fake.respondWith(null);
    fake.setOffline(true);
    await settle(repo.sync());
    expect(told.map((why) => why.cause)).toEqual(["http", "network"]);
  });

  it("tells again after the link came back and was lost once more", async () => {
    const { fake, repo, told } = board();
    fake.respondWith(503);
    await settle(repo.sync());
    fake.respondWith(null);
    await repo.sync();
    fake.respondWith(503);
    await settle(repo.sync());
    expect(told.map((why) => why.cause)).toEqual(["http", "http"]);
  });
});
