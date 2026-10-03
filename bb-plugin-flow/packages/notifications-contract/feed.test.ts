import { describe, expect, it } from "vitest";
import { isPluginUpdatesFeed, PLUGIN_UPDATES_URL, type PluginUpdatesFeed } from "./index.js";

const FEED: PluginUpdatesFeed = {
  plugins: [
    {
      id: "flow",
      name: "Flow",
      version: "0.6.92",
      releases: [
        { version: "0.6.92", date: "2026-10-03", notes: [{ ru: "Стоимость пункта над текстом", en: "Item cost above the text" }] },
        { version: "0.6.91", date: "2026-10-02", notes: [] },
      ],
    },
  ],
};

describe("лента обновлений плагинов", () => {
  it("лежит на сайте витрины", () => {
    expect(PLUGIN_UPDATES_URL).toBe("https://bb68.vercel.app/plugin-updates.json");
  });

  it("принимает целую ленту и пустую", () => {
    expect(isPluginUpdatesFeed(FEED)).toBe(true);
    expect(isPluginUpdatesFeed({ plugins: [] })).toBe(true);
  });

  it("отвергает плагин без id, без версии или с версией не вида x.y.z", () => {
    const plugin = FEED.plugins[0]!;
    expect(isPluginUpdatesFeed({ plugins: [{ ...plugin, id: "" }] })).toBe(false);
    expect(isPluginUpdatesFeed({ plugins: [{ ...plugin, version: undefined }] })).toBe(false);
    expect(isPluginUpdatesFeed({ plugins: [{ ...plugin, version: "latest" }] })).toBe(false);
  });

  it("отвергает выпуск с битой версией или пунктом без перевода", () => {
    const plugin = FEED.plugins[0]!;
    expect(isPluginUpdatesFeed({ plugins: [{ ...plugin, releases: [{ version: "1.0", date: "2026-10-03", notes: [] }] }] })).toBe(false);
    expect(isPluginUpdatesFeed({ plugins: [{ ...plugin, releases: [{ version: "1.0.0", date: "2026-10-03", notes: [{ ru: "есть" }] }] }] })).toBe(false);
  });

  it("отвергает не ленту", () => {
    expect(isPluginUpdatesFeed(null)).toBe(false);
    expect(isPluginUpdatesFeed([])).toBe(false);
    expect(isPluginUpdatesFeed({ plugins: {} })).toBe(false);
  });
});
