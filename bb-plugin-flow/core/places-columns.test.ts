// @vitest-environment node
import { describe, expect, it } from "vitest";

import { placeColumns } from "./places";

const route = { tree: "same", branch: "current" } as const;
const inOther = { tree: "new", branch: "none", projectId: "proj_1" } as const;

describe("колонки выбора места показывают только возможное", () => {
  it("первая колонка держит все места, куда работу можно отправить", () => {
    expect(placeColumns("here", route, true).places).toEqual(["here", "thread", "child", "other"]);
    expect(placeColumns("child", { tree: "new", branch: "from-current" }, true).places).toEqual(["here", "thread", "child", "other"]);
  });

  it("без чужих проектов места «в другом проекте» не предлагают", () => {
    expect(placeColumns("thread", route, false).places).toEqual(["here", "thread", "child"]);
  });

  it("уже выбранное «в другом проекте» из колонки не пропадает, даже когда список не прочитан", () => {
    expect(placeColumns("other", inOther, false).places).toEqual(["here", "thread", "child", "other"]);
  });

  it("при «в этом треде» колонок дерева и ветки нет вовсе", () => {
    const columns = placeColumns("here", route, true);
    expect(columns.trees).toEqual([]);
    expect(columns.branches).toEqual([]);
    expect(columns.projects).toBe(false);
  });

  it("в дереве треда четыре ветки и среди них нет «без ветки»", () => {
    expect(placeColumns("thread", route, true).branches).toEqual(["current", "from-current", "from-origin-main", "from-main"]);
  });

  it("в новом дереве видны только отводы", () => {
    expect(placeColumns("thread", { tree: "new", branch: "from-current" }, true).branches).toEqual(["from-current", "from-origin-main", "from-main"]);
  });

  it("у чужого проекта дерево выбирают из двух: дерева этого треда там нет", () => {
    expect(placeColumns("other", inOther, true).trees).toEqual(["new", "local"]);
    expect(placeColumns("thread", route, true).trees).toEqual(["same", "new", "local"]);
  });

  it("у чужого проекта третья колонка — проекты вместо веток", () => {
    const columns = placeColumns("other", inOther, true);
    expect(columns.projects).toBe(true);
    expect(columns.branches).toEqual([]);
  });

  it("дерево, которого в колонке нет, отступает в новое", () => {
    const columns = placeColumns("other", { tree: "same", branch: "current" }, true);
    expect(columns.tree).toBe("new");
    expect(columns.projects).toBe(true);
  });

  it("отмеченное дерево — то же, что уедет в ответе", () => {
    expect(placeColumns("thread", { tree: "local", branch: "none" }, true).tree).toBe("local");
    expect(placeColumns("other", { tree: "local", branch: "none", projectId: "proj_1" }, true).tree).toBe("local");
  });
});
