import { describe, expect, it } from "vitest";

import { decideAncestry, doneHold, headInBaseArgs } from "./branch-in-main";

describe("headInBaseArgs", () => {
  it("спрашивает, входит ли HEAD ветки в историю базы — а не наоборот", () => {
    expect(headInBaseArgs("origin/main")).toEqual(["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
  });

  it("база с косой чертой доезжает до git как есть", () => {
    expect(headInBaseArgs("origin/release/1.2")).toEqual(["merge-base", "--is-ancestor", "HEAD", "origin/release/1.2"]);
  });
});

describe("decideAncestry", () => {
  it("код 0 — коммит ветки в истории базы", () => {
    expect(decideAncestry({ code: 0, stdout: "" })).toBe("ancestor");
  });

  it("код 1 — git ответил «не предок»", () => {
    expect(decideAncestry({ code: 1, stdout: "" })).toBe("not-ancestor");
  });

  it("любой другой код — сам git упал, ответа нет", () => {
    expect(decideAncestry({ code: 128, stdout: "" })).toBe("unknown");
    expect(decideAncestry({ code: 2, stdout: "" })).toBe("unknown");
  });
});

describe("doneHold", () => {
  it("кода в базе нет — причина и комментарий называют базу, а статус задачи в комментарии не назван", () => {
    const hold = doneHold("not-in-main", "origin/main");
    expect(hold.reason).toContain("origin/main");
    expect(hold.comment).toContain("origin/main");
    expect(hold.comment).not.toContain("in_review");
  });

  it("проверить не вышло — другая причина и другой комментарий, чем «кода нет», и без названия статуса", () => {
    const missing = doneHold("not-in-main", "origin/main");
    const unknown = doneHold("unknown", "origin/main");
    expect(unknown.reason).not.toBe(missing.reason);
    expect(unknown.comment).not.toBe(missing.comment);
    expect(unknown.comment).not.toContain("in_review");
  });
});
