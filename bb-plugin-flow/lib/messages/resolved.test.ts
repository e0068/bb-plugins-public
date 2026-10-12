// @vitest-environment node
import { describe, expect, it } from "vitest";

import { messages } from "./index";

describe("строка решённого уточнения", () => {
  it("по-русски — «Решено: …», по-английски — «Resolved: …»", () => {
    expect(messages("ru").common.resolved("Панель или поповер?")).toBe("Решено: Панель или поповер?");
    expect(messages("en").common.resolved("Panel or popover?")).toBe("Resolved: Panel or popover?");
  });
});
