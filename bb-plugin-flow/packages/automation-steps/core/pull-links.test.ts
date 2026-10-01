import { describe, expect, it } from "vitest";

import { mergedPullLinks, openedPullOutcome } from "./step-links";

const URL = "https://github.com/e0068/bb-plugins/pull/570";
const LINK = { label: "PR #570", target: URL };

describe("ссылки шагов PR", () => {
  it("открытый или найденный PR — строка успеха шага и ссылка на PR", () => {
    expect(openedPullOutcome({ url: URL, number: 570 }, `already open: ${URL}; branch updated`)).toEqual({ ok: true, detail: `already open: ${URL}; branch updated`, links: [LINK] });
  });

  it("мёрдж с известным PR ведёт на сам PR", () => {
    expect(mergedPullLinks({ repo: { owner: "e0068", repo: "bb-plugins" }, number: 570 })).toEqual([LINK]);
  });

  it("мёрдж, для которого GitHub не назвал PR, ссылки не даёт", () => {
    expect(mergedPullLinks(null)).toEqual([]);
  });
});
