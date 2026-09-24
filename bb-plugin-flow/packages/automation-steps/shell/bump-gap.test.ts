import { describe, expect, it } from "vitest";

import { bumpOutcome } from "../core/step-outcomes";
import { settleVersionsForMerge, type GithubPull } from "./pr-helpers";

const noPull: GithubPull = { ok: false, reason: "bb reports no pull request for this branch", gap: "no-pull-request" };
const noToken: GithubPull = { ok: false, reason: "No GitHub token: gh is not authorized" };

describe("шаг бампа без открытого PR", () => {
  it("пробел доезжает от разрешения PR до итога шага: цепочка идёт дальше", async () => {
    const report = await settleVersionsForMerge(noPull, "patch");
    expect(report.gap).toBe("no-pull-request");
    expect(bumpOutcome(report)).toEqual({ ok: true, detail: "no pull request yet — versions are raised by the bump step before the merge" });
  });

  it("настоящая поломка пробелом не прикрывается: шаг падает с причиной", async () => {
    const report = await settleVersionsForMerge(noToken, "patch");
    expect(report.gap ?? null).toBeNull();
    expect(bumpOutcome(report)).toEqual({ ok: false, error: "Versions not raised: No GitHub token: gh is not authorized" });
  });
});
