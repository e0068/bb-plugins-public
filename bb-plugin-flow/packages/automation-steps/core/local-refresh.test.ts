import { describe, expect, it } from "vitest";

import { localRefreshes } from "./local-refresh";

const plugins = [
  { id: "flow", source: "path:/repo/bb-plugin-flow" },
  { id: "mail", source: "path:/repo/bb-plugin-mail/" },
  { id: "tasks-plus", source: "git:https://github.com/e0068/bb-plugins.git@main" },
  { id: "cells", source: "path:/elsewhere/bb-plugin-cells" },
  { id: "quiet", source: "path:/repo/bb-plugin-quiet" },
];

describe("какие плагины пересобрать после подтягивания main", () => {
  it("пересобираются плагины из папок подтянутой копии, чей код изменился; из git, из чужой папки и нетронутые — нет", () => {
    expect(localRefreshes(plugins, "/repo", ["flow", "mail", "tasks-plus", "cells", "absent"])).toEqual([
      { pluginId: "flow", source: "path:/repo/bb-plugin-flow" },
      { pluginId: "mail", source: "path:/repo/bb-plugin-mail/" },
    ]);
  });

  it("путь копии со слэшем на конце — та же копия", () => {
    expect(localRefreshes(plugins, "/repo/", ["flow"])).toEqual([{ pluginId: "flow", source: "path:/repo/bb-plugin-flow" }]);
  });

  it("мёрдж не тронул ни одного плагина — пересобирать нечего", () => {
    expect(localRefreshes(plugins, "/repo", [])).toEqual([]);
  });
});
