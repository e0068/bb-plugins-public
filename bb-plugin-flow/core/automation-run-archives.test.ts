// @vitest-environment node
import { describe, expect, it } from "vitest";

import { archivesThread } from "./automation-run";

const step = (id: string) => ({ id, label: id });

describe("шаги, впереди которых архивация треда", () => {
  it("архивация среди шагов — да, где бы она ни стояла", () => {
    expect(archivesThread([step("bb.archive")])).toBe(true);
    expect(archivesThread([step("git.merge"), step("script:stop-servers"), step("bb.archive")])).toBe(true);
  });

  it("без архивации и пустой список — нет", () => {
    expect(archivesThread([step("git.commit"), step("git.create-pr")])).toBe(false);
    expect(archivesThread([])).toBe(false);
  });

  it("скрипт с тем же словом в id архивацией не считается", () => {
    expect(archivesThread([step("script:bb.archive")])).toBe(false);
  });
});
