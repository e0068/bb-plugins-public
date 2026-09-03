import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { FieldDisplayConfig } from "../shared/contract.js";
import { createTasksStore } from "./index";

function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks-saved-views-test",
  });
  const db = bb.storage.database();
  return { db, harness, store: createTasksStore(db) };
}

const CONFIG_C1: FieldDisplayConfig = {
  fields: [
    { field: "priority", visible: true },
    { field: "labels", visible: false },
  ],
  showEmpty: false,
  showDescription: true,
};

const CONFIG_C2: FieldDisplayConfig = {
  fields: [{ field: "dueDate", visible: true }],
  showEmpty: true,
  showDescription: false,
};

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

describe("saved views store", () => {
  it("creates a view and reads it back through listSavedViews", async () => {
    const { harness, store } = setup();
    try {
      store.createSavedView({ scope: "all", name: "Compact", config: CONFIG_C1 });
      const views = store.listSavedViews("all");
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ name: "Compact", config: CONFIG_C1 });
      expect(views[0]!.id).toMatch(ULID_PATTERN);
      expect(views[0]!.createdAt).not.toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });

  it("isolates views by scope", async () => {
    const { harness, store } = setup();
    try {
      store.createSavedView({ scope: "all", name: "All view", config: CONFIG_C1 });
      const boardScope = "board:01H00000000000000000000ABC";
      store.createSavedView({
        scope: boardScope,
        name: "Board view",
        config: CONFIG_C2,
      });

      expect(store.listSavedViews("all").map((view) => view.name)).toEqual([
        "All view",
      ]);
      expect(
        store.listSavedViews(boardScope).map((view) => view.name),
      ).toEqual(["Board view"]);
    } finally {
      await harness.dispose();
    }
  });

  it("overwrites the config of a view with the same name in the same scope", async () => {
    const { harness, store } = setup();
    try {
      const first = store.createSavedView({
        scope: "all",
        name: "Compact",
        config: CONFIG_C1,
      });
      const second = store.createSavedView({
        scope: "all",
        name: "Compact",
        config: CONFIG_C2,
      });

      const views = store.listSavedViews("all");
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        id: first.id,
        createdAt: first.createdAt,
        config: CONFIG_C2,
      });
      expect(second.id).toBe(first.id);
      expect(second.createdAt).toBe(first.createdAt);
    } finally {
      await harness.dispose();
    }
  });

  it("treats names as case-insensitively unique within a scope", async () => {
    const { harness, store } = setup();
    try {
      store.createSavedView({ scope: "all", name: "Compact", config: CONFIG_C1 });
      store.createSavedView({ scope: "all", name: "compact", config: CONFIG_C2 });

      const views = store.listSavedViews("all");
      expect(views).toHaveLength(1);
      expect(views[0]!.name.toLowerCase()).toBe("compact");
    } finally {
      await harness.dispose();
    }
  });

  it("treats accented names as case-insensitively unique (beyond SQLite's ASCII-only NOCASE)", async () => {
    const { harness, store } = setup();
    try {
      const first = store.createSavedView({
        scope: "all",
        name: "Café",
        config: CONFIG_C1,
      });
      const second = store.createSavedView({
        scope: "all",
        name: "café",
        config: CONFIG_C2,
      });

      expect(second.id).toBe(first.id);
      expect(second.createdAt).toBe(first.createdAt);
      const views = store.listSavedViews("all");
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ id: first.id, config: CONFIG_C2 });
    } finally {
      await harness.dispose();
    }
  });

  it("lets the same name coexist across different scopes", async () => {
    const { harness, store } = setup();
    try {
      const inAll = store.createSavedView({
        scope: "all",
        name: "Compact",
        config: CONFIG_C1,
      });
      const inActive = store.createSavedView({
        scope: "active",
        name: "Compact",
        config: CONFIG_C1,
      });

      expect(inAll.id).not.toBe(inActive.id);
      expect(store.listSavedViews("all")).toHaveLength(1);
      expect(store.listSavedViews("active")).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });

  it("sorts views by name case-insensitively", async () => {
    const { harness, store } = setup();
    try {
      store.createSavedView({ scope: "all", name: "beta", config: CONFIG_C1 });
      store.createSavedView({ scope: "all", name: "Alpha", config: CONFIG_C1 });
      store.createSavedView({ scope: "all", name: "gamma", config: CONFIG_C1 });

      expect(store.listSavedViews("all").map((view) => view.name)).toEqual([
        "Alpha",
        "beta",
        "gamma",
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("deletes a view and reports false for a repeat delete", async () => {
    const { harness, store } = setup();
    try {
      const view = store.createSavedView({
        scope: "all",
        name: "Compact",
        config: CONFIG_C1,
      });

      expect(store.deleteSavedView(view.id)).toBe(true);
      expect(store.listSavedViews("all")).toEqual([]);
      expect(store.deleteSavedView(view.id)).toBe(false);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects a blank or whitespace-only name", async () => {
    const { harness, store } = setup();
    try {
      expect(() =>
        store.createSavedView({ scope: "all", name: "   ", config: CONFIG_C1 }),
      ).toThrow(/must not be empty/);
    } finally {
      await harness.dispose();
    }
  });

  it("skips a saved view row with an unparsable config instead of failing the list", async () => {
    const { db, harness, store } = setup();
    try {
      db.prepare<[string, string, string, string, string]>(
        `INSERT INTO saved_views (id, scope, name, config, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        "01H00000000000000000000XYZ",
        "all",
        "Corrupted",
        "not json",
        new Date().toISOString(),
      );
      store.createSavedView({ scope: "all", name: "Valid", config: CONFIG_C1 });

      const views = store.listSavedViews("all");
      expect(views.map((view) => view.name)).toEqual(["Valid"]);
    } finally {
      await harness.dispose();
    }
  });

  it("drops an unrecognized field entry instead of hiding the whole view", async () => {
    const { db, harness, store } = setup();
    try {
      const configWithRetiredField = {
        fields: [
          { field: "priority", visible: true },
          { field: "retiredField", visible: true },
        ],
        showEmpty: false,
        showDescription: true,
      };
      db.prepare<[string, string, string, string, string]>(
        `INSERT INTO saved_views (id, scope, name, config, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        "01H00000000000000000000RET",
        "all",
        "Has retired field",
        JSON.stringify(configWithRetiredField),
        new Date().toISOString(),
      );

      const views = store.listSavedViews("all");
      expect(views).toHaveLength(1);
      expect(views[0]!.config).toEqual({
        fields: [{ field: "priority", visible: true }],
        showEmpty: false,
        showDescription: true,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("round-trips a partial config (old client, fewer fields) without server-side padding", async () => {
    const { harness, store } = setup();
    try {
      const partial: FieldDisplayConfig = {
        fields: [{ field: "priority", visible: true }],
        showEmpty: false,
        showDescription: false,
      };
      store.createSavedView({ scope: "all", name: "Partial", config: partial });

      const [view] = store.listSavedViews("all");
      expect(view!.config).toEqual(partial);
    } finally {
      await harness.dispose();
    }
  });
});
