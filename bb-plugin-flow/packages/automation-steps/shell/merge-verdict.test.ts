import { describe, expect, it } from "vitest";

import type { GithubRequest, RepoRef } from "../core/github-requests";
import type { GithubResponse } from "../wiring/create-pr";
import { mergeWithVerdict, type GithubPull } from "./pr-helpers";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

type World = {
  /** Ответы GET /pulls/42 по порядку: первый — до мёрджа, второй — после упавшего. */
  states: readonly unknown[];
  mergeable?: boolean | null;
  pullStatus?: number;
};

const pull = (world: World): { gh: GithubPull; calls: GithubRequest[] } => {
  const calls: GithubRequest[] = [];
  let asked = 0;
  const gh: GithubPull = {
    ok: true,
    repo,
    baseBranch: "main",
    headBranch: "bb/thr_x",
    number: 42,
    ports: {
      async send(req: GithubRequest): Promise<GithubResponse> {
        calls.push(req);
        if (req.path.endsWith("/pulls/42")) {
          const state = world.states[Math.min(asked++, world.states.length - 1)];
          const status = world.pullStatus ?? 200;
          return { status, data: status === 200 ? { ...(state as object), mergeable: world.mergeable ?? true } : { message: "Not Found" } };
        }
        throw new Error(`unexpected request ${req.method} ${req.path}`);
      },
    },
  };
  return { gh, calls };
};

const merged = { state: "closed", merged: true };
const open = { state: "open", merged: false };

describe("mergeWithVerdict", () => {
  it("уже влитый PR — успех шага, а не ошибка: мёрдж не зовётся вовсе", async () => {
    const { gh } = pull({ states: [merged] });
    let fired = false;
    expect(await mergeWithVerdict(gh, async () => void (fired = true))).toEqual({ ok: true, detail: "already merged" });
    expect(fired).toBe(false);
  });

  it("закрытый без мёрджа PR — отказ с причиной, повторять нечего", async () => {
    const { gh } = pull({ states: [{ state: "closed", merged: false }] });
    const outcome = await mergeWithVerdict(gh, async () => undefined);
    expect(outcome).toEqual({ ok: false, error: "the pull request is closed without a merge — reopen it or open a new one" });
  });

  it("конфликт назван конфликтом, а не кодом ответа", async () => {
    const { gh } = pull({ states: [open], mergeable: false });
    let fired = false;
    const outcome = await mergeWithVerdict(gh, async () => void (fired = true));
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("conflicts with main") });
    expect(fired).toBe(false);
  });

  it("открытый и сводимый PR мёрджится", async () => {
    const { gh } = pull({ states: [open] });
    let fired = false;
    expect(await mergeWithVerdict(gh, async () => void (fired = true))).toEqual({ ok: true, detail: null });
    expect(fired).toBe(true);
  });

  it("мёрдж, упавший по потерянному ответу, проверяется у GitHub и считается успехом", async () => {
    const { gh } = pull({ states: [open, merged] });
    const outcome = await mergeWithVerdict(gh, async () => {
      throw new Error("HTTP 502: Bad Gateway");
    });
    expect(outcome).toEqual({ ok: true, detail: "already merged" });
  });

  it("мёрдж, упавший по-настоящему, отдаёт ошибку как есть — её повторит слой повторов", async () => {
    const { gh } = pull({ states: [open, open] });
    const outcome = await mergeWithVerdict(gh, async () => {
      throw new Error("HTTP 409: Pull request is not currently mergeable");
    });
    expect(outcome).toEqual({ ok: false, error: "HTTP 409: Pull request is not currently mergeable" });
  });

  it("без сведений о PR мёрдж всё равно пробуется: его делает bb, а не мы", async () => {
    let fired = false;
    const outcome = await mergeWithVerdict({ ok: false, reason: "bb reports no pull request for this branch" }, async () => void (fired = true));
    expect(outcome).toEqual({ ok: true, detail: null });
    expect(fired).toBe(true);
  });

  it("без сведений о PR отвечает ошибкой самого bb", async () => {
    const outcome = await mergeWithVerdict({ ok: false, reason: "no token" }, async () => {
      throw new Error("HTTP 409: Pull request is not currently mergeable");
    });
    expect(outcome).toEqual({ ok: false, error: "HTTP 409: Pull request is not currently mergeable" });
  });
});
