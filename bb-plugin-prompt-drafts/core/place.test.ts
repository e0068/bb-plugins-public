// @vitest-environment node
import { describe, expect, it } from "vitest";
import { placeOf, type SidebarView } from "./place";

const SIDEBAR: SidebarView = {
  projects: [
    { id: "p_1", name: "bb-plugins" },
    { id: "p_2", name: "corpus" },
  ],
  threads: [
    {
      id: "thr_1",
      projectId: "p_1",
      title: "Projects — стадийная загрузка",
      titleFallback: null,
      environment: { name: "thr_k2p9x", branchName: "bb/projects-staged-load" },
    },
    { id: "thr_2", projectId: "p_2", title: null, titleFallback: "Новый тред", environment: null },
  ],
};

describe("место черновика", () => {
  it("в треде — название, проект, окружение и ветка из сайдбара", () => {
    expect(placeOf({ threadId: "thr_1" }, SIDEBAR)).toEqual({
      threadId: "thr_1",
      threadTitle: "Projects — стадийная загрузка",
      projectId: "p_1",
      projectName: "bb-plugins",
      worktree: "thr_k2p9x",
      branch: "bb/projects-staged-load",
    });
  });

  it("у безымянного треда берётся запасное название, без окружения дерево и ветка пусты", () => {
    expect(placeOf({ threadId: "thr_2" }, SIDEBAR)).toEqual({
      threadId: "thr_2",
      threadTitle: "Новый тред",
      projectId: "p_2",
      projectName: "corpus",
      worktree: null,
      branch: null,
    });
  });

  it("тред, которого сайдбар не знает, сохраняет только свой id", () => {
    expect(placeOf({ threadId: "thr_x" }, SIDEBAR)).toEqual({
      threadId: "thr_x",
      threadTitle: null,
      projectId: null,
      projectName: null,
      worktree: null,
      branch: null,
    });
  });

  it("на Home — проект по id, без треда, дерева и ветки", () => {
    expect(placeOf({ projectId: "p_2" }, SIDEBAR)).toEqual({
      threadId: null,
      threadTitle: null,
      projectId: "p_2",
      projectName: "corpus",
      worktree: null,
      branch: null,
    });
  });

  it("на Home без проекта или с неизвестным проектом имени проекта нет", () => {
    expect(placeOf({ projectId: null }, SIDEBAR).projectName).toBeNull();
    expect(placeOf({ projectId: "p_x" }, SIDEBAR)).toMatchObject({ projectId: "p_x", projectName: null });
  });
});
