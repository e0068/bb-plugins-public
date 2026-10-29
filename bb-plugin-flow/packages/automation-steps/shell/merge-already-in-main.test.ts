// BBPL-987: PR #856 влили, повтор «Смёрджить PR» через три минуты упал «The pull request was not found on GitHub» —
// GitHub ищет только открытый PR, а влитого уже нет среди открытых. Агент принял это за неоткрытый PR, и
// появился дубль #861. Нет PR, а код ветки уже в main — шаг сделал своё: зелёный «уже влито».
import { describe, expect, it } from "vitest";

import type { BranchInMain } from "../core/branch-in-main";
import { mergeThroughHostOrGithub, mergeWithVerdict, type GithubPull, type Sdk } from "./pr-helpers";

const noPull: GithubPull = { ok: false, reason: "bb reports no pull request for this branch", gap: "no-pull-request" };

/** bb 0.47.1 без метода мёржа у хоста — PR вливается только запросом к GitHub, как в треде BBPL-980. */
const sdkWithout = { environments: {} } as unknown as Sdk;

const answers = (verdict: BranchInMain) => {
  const asked: string[] = [];
  return { asked, inMain: async () => (asked.push("in-main?"), verdict) };
};

describe("«Смёрджить PR», когда PR ветки не найден", () => {
  it("код ветки уже в main — шаг зелёный «уже влито», мёрдж не пробуется", async () => {
    const { inMain } = answers("in-main");
    let fired = false;
    const outcome = await mergeWithVerdict(noPull, async () => void (fired = true), inMain);
    expect(outcome).toEqual({ ok: true, detail: "already merged" });
    expect(fired).toBe(false);
  });

  it("повтор после влитого PR на хосте без метода мёржа — «уже влито», а не «PR not found»", async () => {
    const { inMain } = answers("in-main");
    expect(await mergeWithVerdict(noPull, mergeThroughHostOrGithub(sdkWithout, noPull, "e1"), inMain)).toEqual({ ok: true, detail: "already merged" });
  });

  it("кода ветки в main нет и PR нет — шаг падает с причиной, что PR не найден", async () => {
    const { inMain } = answers("not-in-main");
    expect(await mergeWithVerdict(noPull, mergeThroughHostOrGithub(sdkWithout, noPull, "e1"), inMain)).toEqual({
      ok: false,
      error: "The pull request was not found on GitHub: bb reports no pull request for this branch",
    });
  });

  it("проверить main не вышло — шаг не выдумывает «уже влито» и падает с той же причиной", async () => {
    const { inMain } = answers("unknown");
    expect(await mergeWithVerdict(noPull, mergeThroughHostOrGithub(sdkWithout, noPull, "e1"), inMain)).toMatchObject({ ok: false });
  });

  it("PR не узнать по другой причине (нет токена) — main не спрашивается, мёрдж пробуется как раньше", async () => {
    const { asked, inMain } = answers("in-main");
    let fired = false;
    expect(await mergeWithVerdict({ ok: false, reason: "no token" }, async () => void (fired = true), inMain)).toEqual({ ok: true, detail: null });
    expect(fired).toBe(true);
    expect(asked).toEqual([]);
  });
});
