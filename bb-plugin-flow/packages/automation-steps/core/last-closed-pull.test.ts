import { describe, expect, it } from "vitest";

import { parseLastClosedPull } from "./github-requests";

describe("parseLastClosedPull — судьба самого нового закрытого PR ветки", () => {
  it("самый новый влит — «merged»", () => {
    expect(parseLastClosedPull([{ number: 862, merged_at: "2026-10-27T16:30:00Z" }, { number: 850, merged_at: null }])).toBe("merged");
  });

  it("самый новый закрыт без мёржа — «unmerged», даже если раньше ветку вливали", () => {
    expect(parseLastClosedPull([{ number: 863, merged_at: null }, { number: 862, merged_at: "2026-10-27T16:30:00Z" }])).toBe("unmerged");
  });

  it("закрытых PR нет — «none»", () => {
    expect(parseLastClosedPull([])).toBe("none");
  });

  it("ответ не список — null", () => {
    expect(parseLastClosedPull({ message: "Not Found" })).toBeNull();
  });
});
