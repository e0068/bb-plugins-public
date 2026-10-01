// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as preference from "./view-preference.js";

const { loadLayout, storeLayout } = preference as unknown as {
  loadLayout: (key: string) => "table" | "board";
  storeLayout: (key: string, layout: "table" | "board") => void;
};

beforeEach(() => window.localStorage.clear());

describe("each screen remembers table or board", () => {
  it("opens a table where nothing was chosen", () => {
    expect(loadLayout("all")).toBe("table");
    expect(loadLayout("project:P1")).toBe("table");
    expect(loadLayout("view:V1")).toBe("table");
  });

  it("each screen and each view keeps its own layout", () => {
    storeLayout("all", "board");
    storeLayout("active", "table");
    storeLayout("project:P1", "board");
    storeLayout("view:V1", "board");
    expect(loadLayout("all")).toBe("board");
    expect(loadLayout("active")).toBe("table");
    expect(loadLayout("waiting")).toBe("table");
    expect(loadLayout("project:P1")).toBe("board");
    expect(loadLayout("project:P2")).toBe("table");
    expect(loadLayout("view:V1")).toBe("board");
    expect(loadLayout("view:V2")).toBe("table");
  });

  it("an old per-project choice carries over, list as table", () => {
    window.localStorage.setItem(
      "bb-tasks:view-preferences",
      JSON.stringify({ version: 1, lastUsed: "board", projects: { P1: "board", P2: "list" } }),
    );
    expect(loadLayout("project:P1")).toBe("board");
    expect(loadLayout("project:P2")).toBe("table");
  });

  it("survives storage that refuses writes", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => storeLayout("all", "board")).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
