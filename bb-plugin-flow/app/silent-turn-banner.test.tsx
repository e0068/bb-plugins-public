// @vitest-environment jsdom
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";

const app = await loadPluginApp(() => import("../app"));

describe("плашка немого хода над композером", () => {
  it("зарегистрирована над композером треда своим контейнером, без карточки", async () => {
    const customization = app.composerCustomizations.find((c) => c.id === "flow-silent-turn");
    expect(customization?.scopes).toEqual(["thread"]);
    expect(customization?.banners?.map((banner) => [banner.id, banner.chrome])).toEqual([["silent-turn", "bare"]]);
  });

  it("стоит над контейнером состояния Flow", async () => {
    const ids = app.composerCustomizations.map((c) => c.id);
    expect(ids.indexOf("flow-silent-turn")).toBeLessThan(ids.indexOf("flow-progress"));
  });
});
