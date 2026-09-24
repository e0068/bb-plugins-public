// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const row = (id: string, state: string, number: number | null, minutes: number | null = null, wallMinutes: number | null = null) => ({
  id,
  kind: "skill",
  name: id,
  executor: "self",
  state,
  results: [],
  number,
  minutes,
  wallMinutes,
  cost: null,
});

const view = {
  current: "code",
  done: 3,
  step: 4,
  total: 5,
  planned: null,
  environmentId: null,
  stages: [
    row("questions", "done", 1, 7, 7),
    row("task", "done", 2, 4, 12),
    { ...row("demo", "done", 3, 7, 591), kind: "demo" },
    row("prototype", "skip", null),
    row("code", "now", 4),
    row("review", "todo", 5),
  ],
};

const mount = async (progress: unknown = view) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
};

const expand = async (slot: Awaited<ReturnType<typeof mount>>) => {
  (await screen.findByRole("button", { name: /Прогресс flow/ })).click();
  return slot;
};

describe("номера и время этапов в раскрытом баннере", () => {
  it("этапы прогона пронумерованы по порядку, у «не в прогоне» номера нет", async () => {
    const slot = await expand(await mount());
    expect([...slot.container.querySelectorAll("[data-progress-number]")].map((n) => n.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    const skipped = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("prototype"))!;
    expect(skipped.querySelector("[data-progress-number]")).toBeNull();
  });

  it("номер — самая левая колонка строки, до значка этапа", async () => {
    const slot = await expand(await mount());
    const questions = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("questions"))!;
    expect(questions.firstElementChild?.hasAttribute("data-progress-number")).toBe(true);
    expect(questions.firstElementChild?.textContent).toBe("1");
  });

  it("строка без номера держит колонку пустой — значки этапов стоят в один столбец", async () => {
    const slot = await expand(await mount());
    const skipped = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("prototype"))!;
    const questions = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("questions"))!;
    expect(skipped.children.length).toBe(questions.children.length);
    expect(skipped.firstElementChild?.textContent).toBe("");
  });

  it("длинное название этапа переносится на следующую строку, а не обрезается", async () => {
    const slot = await expand(await mount());
    const questions = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("questions"))!;
    const label = questions.querySelector("[data-progress-label]")!;
    expect(label.className).not.toMatch(/truncate|whitespace-nowrap/);
  });

  it("минуты этапа — активные, полное время этапа видно подсказкой", async () => {
    const slot = await expand(await mount());
    const demo = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("demo"))!;
    expect(demo.textContent).toContain("7 м");
    expect(demo.querySelector("[data-progress-spent]")?.getAttribute("title")).toBe("в работе 7 м из 591 м");
  });

  it("этап, у которого активные минуты равны полному времени, подсказкой не дублируется", async () => {
    const slot = await expand(await mount());
    const questions = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("questions"))!;
    expect(questions.querySelector("[data-progress-spent]")?.getAttribute("title")).toBeNull();
  });
});

// Вторая раскладка: этап с длинным названием и длинной ссылкой на результат — на ней видно перенос,
// и этап-автоматизация, чтобы в разметке появилась строка шага. Отдельная от `view`, потому что
// тесты нумерации и минут выше ждут именно её шесть этапов.
const wrapping = {
  ...view,
  current: "land",
  stages: [
    {
      ...row("long", "done", 1),
      name: "Этап с названием, которое в одну строку баннера не помещается никак",
      results: [{ label: "docs/tasks/done/flow-zhurnal-reshenii-ne-pishetsya-na-disk-iz-za-otnositelno.md", target: "docs/tasks/done/flow-zhurnal-reshenii-ne-pishetsya-na-disk-iz-za-otnositelno.md" }],
    },
    {
      ...row("land", "now", 2),
      automation: {
        steps: [
          { id: "git.merge", label: "Merge the PR", state: "done", error: null },
          { id: "bb.archive", label: "Archive the thread", state: "todo", error: null },
        ],
      },
    },
  ],
};

const rowOf = (slot: Awaited<ReturnType<typeof mount>>, id: string) => [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes(id))!;

describe("длинное содержимое строки переносится, а не обрезается", () => {
  it("ни название, ни ссылка на результат не обрезаны, ячейка содержимого переносит", async () => {
    const slot = await expand(await mount(wrapping));
    const long = rowOf(slot, "не помещается");
    const label = long.querySelector("[data-progress-label]")!;
    const link = long.querySelector("button")!;
    expect(label.className).not.toMatch(/truncate|whitespace-nowrap/);
    expect(link.className).not.toMatch(/truncate|whitespace-nowrap/);
    expect(label.parentElement?.className).toMatch(/flex-wrap/);
  });

  it("заметка этапа не обрезана", async () => {
    const slot = await expand(await mount(wrapping));
    const note = rowOf(slot, "land").querySelector("[data-progress-label]")!.parentElement!.lastElementChild!;
    expect(note.className).not.toMatch(/truncate/);
  });
});

describe("сетку колонок держат строка этапа и строка его шага", () => {
  // Кнопка-шапка из этой сетки вышла: слева у неё номер и общее число этапов,
  // а не номер и значок, — и колонок у неё своих четыре.
  it("строка шага автоматизации даёт столько же ячеек, сколько строка этапа", async () => {
    const slot = await expand(await mount(wrapping));
    const cells = rowOf(slot, "land").children.length;
    expect(slot.container.querySelector("[data-progress-step]")!.children.length).toBe(cells);
  });
});
