import { describe, expect, it } from "vitest";

import { pullLink, pullUrl, taskLink, withLinks } from "./step-links";

describe("ссылки шагов", () => {
  it("PR называется номером и ведёт по своему адресу", () => {
    expect(pullLink(570, "https://github.com/e0068/bb-plugins/pull/570")).toEqual({ label: "PR #570", target: "https://github.com/e0068/bb-plugins/pull/570" });
  });

  it("адрес PR строится из репозитория и номера", () => {
    expect(pullUrl({ owner: "e0068", repo: "bb-plugins" }, 570)).toBe("https://github.com/e0068/bb-plugins/pull/570");
  });

  it("задача называется ключом и ведёт на свой файл в done", () => {
    expect(taskLink({ key: "BBPL-12", slug: "flow-ssylki" })).toEqual({ label: "BBPL-12", target: "docs/tasks/done/flow-ssylki.md" });
  });

  it("успех шага несёт ссылки рядом со строкой успеха", () => {
    const link = { label: "PR #1", target: "https://github.com/o/r/pull/1" };
    expect(withLinks({ ok: true, detail: "already merged" }, [link])).toEqual({ ok: true, detail: "already merged", links: [link] });
  });

  it("без ссылок итог шага не меняется — поля links нет вовсе", () => {
    expect(withLinks({ ok: true, detail: null }, [])).toEqual({ ok: true, detail: null });
  });

  it("провал шага ссылок не получает", () => {
    expect(withLinks({ ok: false, error: "conflict" }, [{ label: "PR #1", target: "https://github.com/o/r/pull/1" }])).toEqual({ ok: false, error: "conflict" });
  });
});
