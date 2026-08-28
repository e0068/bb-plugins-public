import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { FieldDisplayConfig } from "../shared/contract";
import { createStore, registerTasksApi } from ".";

const CONFIG: FieldDisplayConfig = {
  fields: [{ field: "priority", visible: true }],
  showEmpty: false,
  showDescription: true,
};

const OTHER_CONFIG: FieldDisplayConfig = {
  fields: [{ field: "labels", visible: false }],
  showEmpty: true,
  showDescription: false,
};

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = createStore(bb);
  registerTasksApi(bb, store);
  return { harness, store };
}

describe("saved views RPC", () => {
  it("round-trips a view through create, list, and delete", async () => {
    const { harness } = setup();
    try {
      const created = (await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: CONFIG,
      })) as { savedView: { id: string } };
      expect(created.savedView).toMatchObject({
        scope: "all",
        name: "Compact",
        config: CONFIG,
      });

      const listed = (await harness.callRpc("listSavedViews", {
        scope: "all",
      })) as { savedViews: { id: string }[] };
      expect(listed.savedViews.map((view) => view.id)).toEqual([
        created.savedView.id,
      ]);

      await expect(
        harness.callRpc("deleteSavedView", {
          savedViewId: created.savedView.id,
        }),
      ).resolves.toEqual({ deleted: true });
      const afterDelete = (await harness.callRpc("listSavedViews", {
        scope: "all",
      })) as { savedViews: unknown[] };
      expect(afterDelete.savedViews).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("isolates views by scope through the RPC layer", async () => {
    const { harness } = setup();
    try {
      await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: CONFIG,
      });

      const boardListed = (await harness.callRpc("listSavedViews", {
        scope: "board:01H00000000000000000000ABC",
      })) as { savedViews: unknown[] };
      expect(boardListed.savedViews).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("overwrites the same-named view through the RPC layer", async () => {
    const { harness } = setup();
    try {
      const first = (await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: CONFIG,
      })) as { savedView: { id: string } };
      const second = (await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: OTHER_CONFIG,
      })) as { savedView: { id: string; config: FieldDisplayConfig } };

      expect(second.savedView.id).toBe(first.savedView.id);
      expect(second.savedView.config).toEqual(OTHER_CONFIG);

      const listed = (await harness.callRpc("listSavedViews", {
        scope: "all",
      })) as { savedViews: unknown[] };
      expect(listed.savedViews).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects an empty name, an unknown field, and a non-ULID delete target", async () => {
    const { harness } = setup();
    try {
      await expect(
        harness.callRpc("createSavedView", {
          scope: "all",
          name: "",
          config: CONFIG,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });

      await expect(
        harness.callRpc("createSavedView", {
          scope: "all",
          name: "Bad field",
          config: {
            fields: [{ field: "not-a-field", visible: true }],
            showEmpty: false,
            showDescription: false,
          },
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });

      await expect(
        harness.callRpc("deleteSavedView", { savedViewId: "not-a-ulid" }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    } finally {
      await harness.dispose();
    }
  });

  it("reports deleted: false for a valid but unknown ULID", async () => {
    const { harness } = setup();
    try {
      await expect(
        harness.callRpc("deleteSavedView", {
          savedViewId: "01H00000000000000000000ABC",
        }),
      ).resolves.toEqual({ deleted: false });
    } finally {
      await harness.dispose();
    }
  });

  // views:changed is the only contract this group shares with the client
  // group, and its channel name is a bare string literal on both sides (no
  // shared constant) — a typo here would silently break cross-tab sync.
  it("publishes views:changed on create, including an overwrite", async () => {
    const { harness } = setup();
    try {
      await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: CONFIG,
      });
      expect(harness.realtimeSignals).toEqual([
        { channel: "views:changed", payload: {} },
      ]);

      await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: OTHER_CONFIG,
      });
      expect(harness.realtimeSignals).toEqual([
        { channel: "views:changed", payload: {} },
        { channel: "views:changed", payload: {} },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("publishes views:changed when an existing view is deleted", async () => {
    const { harness } = setup();
    try {
      const created = (await harness.callRpc("createSavedView", {
        scope: "all",
        name: "Compact",
        config: CONFIG,
      })) as { savedView: { id: string } };
      const signalsBeforeDelete = harness.realtimeSignals.length;

      await expect(
        harness.callRpc("deleteSavedView", {
          savedViewId: created.savedView.id,
        }),
      ).resolves.toEqual({ deleted: true });
      expect(harness.realtimeSignals.slice(signalsBeforeDelete)).toEqual([
        { channel: "views:changed", payload: {} },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("publishes nothing when deleting a valid but unknown ULID", async () => {
    const { harness } = setup();
    try {
      const signalsBefore = harness.realtimeSignals.length;

      await expect(
        harness.callRpc("deleteSavedView", {
          savedViewId: "01H00000000000000000000ABC",
        }),
      ).resolves.toEqual({ deleted: false });
      expect(harness.realtimeSignals).toHaveLength(signalsBefore);
    } finally {
      await harness.dispose();
    }
  });
});
