import { describe, expect, it } from "vitest";

import { openKey, panelRoute, parsePanelRoute, type PanelPlace } from "../src/panel-route";

describe("a settings key open in the document column", () => {
  const place: PanelPlace = { areaId: "global", section: "settings", open: { kind: "setting", key: "autoMode" } };

  it("is written as a tagged segment and reads back the same", () => {
    expect(panelRoute(place)).toBe("a/global/s/settings/setting/autoMode");
    expect(parsePanelRoute(panelRoute(place))).toEqual(place);
  });

  it("has its own key, apart from other targets", () => {
    expect(openKey(place.open)).toBe("setting/autoMode");
    expect(openKey({ kind: "skill", name: "autoMode" })).not.toBe(openKey(place.open));
  });

  it("a key the catalog doesn't know opens nothing, the area and section stand", () => {
    expect(parsePanelRoute("a/global/s/settings/setting/noSuchKey")).toEqual({
      areaId: "global",
      section: "settings",
      open: null,
    });
  });
});
