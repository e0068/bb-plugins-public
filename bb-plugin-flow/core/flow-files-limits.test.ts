// Переключатели ограничений едут через папку синхронизации вместе с flow.
import { describe, expect, it } from "vitest";

import type { FlowSettings } from "../shared/contract";
import { SETTINGS_FILE, fromFlowFiles, toFlowFiles } from "./flow-files";

const settings: FlowSettings = {
  version: 2,
  minButtonWidth: 160,
  flows: [
    { id: "a", name: "A", stages: [], limitSkills: true, limitAgents: true },
    { id: "b", name: "B", stages: [] },
  ],
};

describe("переключатели flow в папке синхронизации", () => {
  it("раскладка в файлы и обратная сборка сохраняют переключатели, flow без них остаётся без них", () => {
    const files = toFlowFiles(settings);
    const flows = files.filter((f) => f.path !== SETTINGS_FILE).map((f) => ({ path: f.path, flow: JSON.parse(f.text) }));
    const collection = JSON.parse(files.find((f) => f.path === SETTINGS_FILE)!.text);
    const assembled = fromFlowFiles(flows, collection, settings);
    expect(assembled.kind === "ok" ? assembled.settings.flows : []).toEqual(settings.flows);
  });
});
