import { describe, expect, it } from "vitest";

import { parentNote } from "./parent-delivery";

const wave = { title: "Механизм функций — волна 0", branch: "bb/0-thr_c", parentBranch: "bb/umbrella-thr_p", head: "e6f7ef9a1b2c3d4e" };

describe("сообщение родителю о влитой волне", () => {
  it("называет волну, её ветку, ветку родителя и короткий коммит", () => {
    const text = parentNote(wave);
    for (const fact of [wave.title, wave.branch, wave.parentBranch, "e6f7ef9"]) expect(text).toContain(fact);
    expect(text).not.toContain(wave.head);
  });

  it("говорит, что PR в main не будет и следующие волны идут от ветки родителя", () => {
    const text = parentNote(wave);
    expect(text).toMatch(/no PR/i);
    expect(text).toContain(`from ${wave.parentBranch}`);
  });

  it("волна без названия называется своей веткой", () => {
    expect(parentNote({ ...wave, title: null })).toContain(`"${wave.branch}"`);
  });
});
