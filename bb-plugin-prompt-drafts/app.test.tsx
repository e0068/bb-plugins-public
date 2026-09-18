// @vitest-environment jsdom
//
// Обещания поверхностей: кнопка «Save Draft» в композере, ряд карточек на Home
// и над композером треда. Правила «что видно где» закреплены в
// core/drafts.test.ts; здесь — что поверхность зовёт нужный RPC и пишет в
// композер нужный текст.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { PluginComposerScope, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Draft, Place } from "./core/drafts";
import { CARD_TEXT_OPTIONS } from "./core/settings";
import type { rpcContract } from "./server";

afterEach(cleanup);

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const saveAction = customization.actions![0]!;
const banner = customization.banners![0]!;

const HOME: Place = { threadId: null, threadTitle: null, projectId: "p_1", projectName: "bb-plugins", worktree: null, branch: null };
const THREAD_1: Place = {
  threadId: "thr_1",
  threadTitle: "Projects — стадийная загрузка",
  projectId: "p_1",
  projectName: "bb-plugins",
  worktree: "thr_k2p9x",
  branch: "bb/projects-staged-load",
};
const THREAD_2: Place = { ...THREAD_1, threadId: "thr_2", threadTitle: "Decisions — голос" };

const draft = (id: string, text: string, place: Place): Draft => ({ id, text, createdAt: 1, place });

const DRAFTS = [
  draft("h1", "Черновик с **Home**", HOME),
  draft("t1", "Черновик первого треда", THREAD_1),
  draft("t2", "Черновик второго треда", THREAD_2),
  draft("h2", "Второй с Home", HOME),
];

const sidebarThread = (id: string, title: string): PluginSidebarThread => ({
  id,
  projectId: "p_1",
  title,
  titleFallback: null,
  parentThreadId: null,
  sectionId: null,
  originKind: null,
  originPluginId: null,
  providerId: "claude",
  hasPendingInteraction: false,
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  indicator: "none",
  indicatorLabel: null,
  isUnread: false,
  isPinned: false,
  isArchived: false,
  environment: { id: "env_1", name: "thr_k2p9x", branchName: "bb/projects-staged-load", providerId: null, workspaceDisplayKind: "managed-worktree" },
  host: null,
  createdAt: 0,
  updatedAt: 0,
  lastReadAt: null,
  latestAttentionAt: 0,
});

const SIDEBAR = {
  status: "ready" as const,
  threads: [sidebarThread("thr_1", THREAD_1.threadTitle!)],
  projects: [{ id: "p_1", name: "bb-plugins", isPersonal: false }],
};

type Options = RenderSlotOptions<typeof rpcContract>;

/** RPC в памяти: тот же порядок и обмен, что у сервера, с журналом вызовов у харнесса. */
function memoryRpc(initial: readonly Draft[]): NonNullable<Options["rpc"]> {
  let list = [...initial];
  let seq = 0;
  return {
    list: () => ({ drafts: list }),
    save: ({ text, place }) => {
      const saved = draft(`new${++seq}`, text, place);
      list = [saved, ...list];
      return { draft: saved };
    },
    swap: ({ takeId, put }) => {
      const index = list.findIndex((item) => item.id === takeId);
      if (index === -1) return { taken: null };
      const taken = list[index]!;
      const rest = put === null ? [] : [draft(`new${++seq}`, put.text, put.place)];
      list = [...list.slice(0, index), ...rest, ...list.slice(index + 1)];
      return { taken };
    },
    remove: ({ id }) => {
      list = list.filter((item) => item.id !== id);
      return { ok: true as const };
    },
    autosave: () => ({ ok: true as const }),
  };
}

const threadScope: PluginComposerScope = { kind: "thread", threadId: "thr_1" };
const homeScope: PluginComposerScope = { kind: "new-thread", projectId: "p_1" };

// Слоты разного типа пропсов проходят через один помощник.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(registration: { component: React.ComponentType<any> }, props: object, options: Options = {}) {
  return renderSlot(registration, props, {
    rpc: memoryRpc(DRAFTS),
    sidebarThreads: SIDEBAR,
    ...options,
  });
}

describe("кнопка Save Draft", () => {
  it("на пустом композере неактивна", async () => {
    const slot = render(saveAction, {}, { composer: { text: "  \n", scope: threadScope } });
    expect((await slot.findByRole("button", { name: "Save Draft" })).hasAttribute("disabled")).toBe(true);
  });

  it("сохраняет текст с разметкой и местом треда и очищает композер", async () => {
    const slot = render(saveAction, {}, { composer: { text: "**важно**\n- пункт", scope: threadScope } });
    fireEvent.click(await slot.findByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
    const save = slot.inspection.rpcCalls.find((call) => call.method === "save");
    expect(save?.input).toEqual({ text: "**важно**\n- пункт", place: THREAD_1 });
  });

  it("на Home сохраняет проект композера без треда", async () => {
    const slot = render(saveAction, {}, { composer: { text: "идея", scope: homeScope } });
    fireEvent.click(await slot.findByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
    expect(slot.inspection.rpcCalls.find((call) => call.method === "save")?.input).toEqual({ text: "идея", place: HOME });
  });

  it("выглядит как кнопка выбора модели и effort, но с полями под подпись", async () => {
    const slot = render(saveAction, {}, { composer: { text: "x", scope: threadScope } });
    const button = await slot.findByRole("button", { name: "Save Draft" });
    for (const name of ["h-8", "px-2", "gap-1.5", "text-xs", "text-muted-foreground", "font-normal", "bg-transparent"]) {
      expect(button.classList).toContain(name);
    }
    expect(button.classList).not.toContain("px-1");
  });
});

describe("карточки на Home", () => {
  const cardTexts = (slot: ReturnType<typeof render>) =>
    slot.queryAllByRole("button", { name: /^Send to Composer/ }).map((card) => card.textContent ?? "");

  it("живут баннером композера, а не секцией домашнего экрана с заголовком", () => {
    expect(app.homepageSections).toHaveLength(0);
    expect(customization.banners).toHaveLength(1);
    expect(customization.scopes).toContain("new-thread");
    expect(banner.chrome).toBe("bare");
  });

  it("показывают черновики вне тредов", async () => {
    const slot = render(banner, {}, { composer: { text: "", scope: homeScope } });
    await waitFor(() => expect(cardTexts(slot)).toHaveLength(2));
    expect(cardTexts(slot).join(" | ")).toMatch(/Home.*\|.*Второй с Home/);
    expect(slot.queryByText(/первого треда/)).toBeNull();
  });

  it("при выключенной настройке показывают все черновики, у черновиков тредов — название треда", async () => {
    const slot = render(banner, {}, { settings: { showInThreads: false }, composer: { scope: homeScope } });
    await waitFor(() => expect(cardTexts(slot)).toHaveLength(4));
    expect(slot.getByText(THREAD_1.threadTitle!)).toBeTruthy();
    expect(slot.getByText("Decisions — голос")).toBeTruthy();
  });

  it("под текстом мелко проект, дерево и ветка черновика", async () => {
    const slot = render(banner, {}, { settings: { showInThreads: false }, composer: { scope: homeScope } });
    await waitFor(() => expect(slot.getAllByText("thr_k2p9x").length).toBeGreaterThan(0));
    expect(slot.getAllByText("bb/projects-staged-load").length).toBeGreaterThan(0);
    expect(slot.getAllByText("bb-plugins").length).toBe(4);
  });

  it("клик при пустом композере кладёт текст черновика в композер и снимает черновик", async () => {
    const slot = render(banner, {}, { composer: { text: "", scope: homeScope } });
    const [first] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    fireEvent.click(first!);
    await waitFor(() => expect(slot.inspection.composer.text).toBe("Черновик с **Home**"));
    expect(slot.inspection.rpcCalls.find((call) => call.method === "swap")?.input).toEqual({ takeId: "h1", put: null });
  });

  it("клик при непустом композере отдаёт текущий текст в черновик на место карточки", async () => {
    const slot = render(banner, {}, { composer: { text: "набранное", scope: homeScope } });
    const [first] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    fireEvent.click(first!);
    await waitFor(() => expect(slot.inspection.composer.text).toBe("Черновик с **Home**"));
    expect(slot.inspection.rpcCalls.find((call) => call.method === "swap")?.input).toEqual({
      takeId: "h1",
      put: { text: "набранное", place: HOME },
    });
  });

  it("крестик удаляет черновик без отправки в композер", async () => {
    const slot = render(banner, {}, { composer: { text: "набранное", scope: homeScope } });
    const [remove] = await slot.findAllByRole("button", { name: "Delete draft" });
    fireEvent.click(remove!);
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "remove")).toBe(true));
    expect(slot.inspection.rpcCalls.find((call) => call.method === "remove")?.input).toEqual({ id: "h1" });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "swap")).toBe(false);
    expect(slot.inspection.composer.text).toBe("набранное");
  });

  it("ширина карточки и число строк берутся из настроек", async () => {
    const slot = render(banner, {}, { settings: { cardWidth: 300, cardLines: 4 }, composer: { scope: homeScope } });
    const [card] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    expect(card!.closest<HTMLElement>("[data-draft-card]")!.style.width).toBe("300px");
    expect(card!.querySelector<HTMLElement>("[data-draft-text]")!.style.getPropertyValue("--draft-lines")).toBe("4");
  });

  it("перечитывают список по сигналу drafts-changed", async () => {
    const rpc = memoryRpc([]);
    const slot = render(banner, {}, { rpc, composer: { scope: homeScope } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "list")).toBe(true));
    await rpc.save({ text: "из другого окна", place: HOME });
    await slot.behavior.emitRealtime("drafts-changed", {});
    expect(await slot.findByText("из другого окна")).toBeTruthy();
  });
});

describe("карточки над композером треда", () => {
  it("показывают только черновики этого треда, без карточки про остальные", async () => {
    const slot = render(banner, {}, { composer: { text: "", scope: threadScope } });
    await waitFor(() => expect(slot.getAllByRole("button", { name: /^Send to Composer/ })).toHaveLength(1));
    expect(slot.getByText("Черновик первого треда")).toBeTruthy();
    expect(slot.queryByText(/outside this thread/)).toBeNull();
    expect(slot.queryByText(/Home/)).toBeNull();
  });

  it("клик по карточке в треде отдаёт текст треда в черновик с местом треда", async () => {
    const slot = render(banner, {}, { composer: { text: "в треде набрано", scope: threadScope } });
    fireEvent.click(await slot.findByRole("button", { name: /^Send to Composer/ }));
    await waitFor(() => expect(slot.inspection.composer.text).toBe("Черновик первого треда"));
    expect(slot.inspection.rpcCalls.find((call) => call.method === "swap")?.input).toEqual({
      takeId: "t1",
      put: { text: "в треде набрано", place: THREAD_1 },
    });
  });

  it("при выключенной настройке над композером треда ничего нет", async () => {
    const slot = render(banner, {}, { composer: { scope: threadScope }, settings: { showInThreads: false } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "list")).toBe(true));
    expect(slot.queryAllByRole("button")).toHaveLength(0);
  });

  it("в чужой области композера баннер пуст", async () => {
    const slot = render(banner, {}, { composer: { scope: { kind: "side-chat", projectId: "p_1", parentThreadId: "thr_1", tabId: "tab_1", childThreadId: null } } });
    await act(async () => {});
    expect(slot.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("подсказка и доступность карточки", () => {
  it("на пустом композере подсказка без второй строки, на непустом — что текст сохранится черновиком", async () => {
    const empty = render(banner, {}, { composer: { text: "", scope: homeScope } });
    const [card] = await empty.findAllByRole("button", { name: /^Send to Composer/ });
    await act(async () => {
      fireEvent.focus(card!);
    });
    expect((await empty.findAllByText("Send to Composer")).length).toBeGreaterThan(0);
    expect(empty.queryByText("Current text will be saved as a draft")).toBeNull();
    cleanup();

    const filled = render(banner, {}, { composer: { text: "набранное", scope: homeScope } });
    const [filledCard] = await filled.findAllByRole("button", { name: /^Send to Composer/ });
    await act(async () => {
      fireEvent.focus(filledCard!);
    });
    expect((await filled.findAllByText("Current text will be saved as a draft")).length).toBeGreaterThan(0);
  });

  it("у карточек разные доступные имена — в имени есть начало текста черновика", async () => {
    const slot = render(banner, {}, { composer: { text: "", scope: homeScope } });
    const cards = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    const names = cards.map((card) => card.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(cards.length);
    expect(names[0]).toMatch(/Черновик с/);
  });

  it("Enter на карточке отправляет её в композер", async () => {
    const slot = render(banner, {}, { composer: { text: "", scope: homeScope } });
    const [card] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    fireEvent.keyDown(card!, { key: "Enter" });
    await waitFor(() => expect(slot.inspection.composer.text).toBe("Черновик с **Home**"));
  });
});

describe("устойчивость обмена и сохранения", () => {
  it("два быстрых клика по разным карточкам не теряют и не задваивают тексты", async () => {
    const rpc = memoryRpc(DRAFTS);
    const slot = render(banner, {}, { rpc, composer: { text: "набранное", scope: homeScope } });
    const [first, second] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    fireEvent.click(first!);
    fireEvent.click(second!);
    await waitFor(() => expect(slot.inspection.composer.text).not.toBe("набранное"));
    await act(async () => {});
    const stored = (await rpc.list(null)).drafts.map((item) => item.text);
    const everywhere = [...stored, slot.inspection.composer.text];
    for (const text of ["набранное", "Черновик с **Home**", "Второй с Home"]) {
      expect(everywhere.filter((item) => item === text)).toHaveLength(1);
    }
  });

  it("если черновик уже снят в другом окне, композер не меняется", async () => {
    const rpc = { ...memoryRpc(DRAFTS), swap: () => ({ taken: null }) };
    const slot = render(banner, {}, { rpc, composer: { text: "набранное", scope: homeScope } });
    const [card] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    fireEvent.click(card!);
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "swap")).toBe(true));
    await act(async () => {});
    expect(slot.inspection.composer.text).toBe("набранное");
  });

  it("провал обмена показывает тост и оставляет композер как был", async () => {
    toastError.mockClear();
    const rpc = {
      ...memoryRpc(DRAFTS),
      swap: () => {
        throw new Error("storage is down");
      },
    };
    const slot = render(banner, {}, { rpc, composer: { text: "набранное", scope: homeScope } });
    const [card] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    fireEvent.click(card!);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]![0])).toMatch(/storage is down/);
    expect(slot.inspection.composer.text).toBe("набранное");
    fireEvent.click(card!);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
  });

  it("провал сохранения показывает тост и не очищает композер", async () => {
    toastError.mockClear();
    const rpc = {
      ...memoryRpc([]),
      save: () => {
        throw new Error("storage is down");
      },
    };
    const slot = render(saveAction, {}, { rpc, composer: { text: "идея", scope: threadScope } });
    fireEvent.click(await slot.findByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(slot.inspection.composer.text).toBe("идея");
  });

  it("текст, дописанный пока шло сохранение, не стирается", async () => {
    let release: () => void = () => {};
    const base = memoryRpc([]);
    const rpc = {
      ...base,
      save: async (input: Parameters<typeof base.save>[0]) => {
        await new Promise<void>((resolve) => (release = resolve));
        return base.save(input);
      },
    };
    const slot = render(saveAction, {}, { rpc, composer: { text: "идея", scope: threadScope } });
    fireEvent.click(await slot.findByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "save")).toBe(true));
    await slot.behavior.setComposerText("идея и ещё");
    await act(async () => release());
    await waitFor(async () => expect((await base.list(null)).drafts).toHaveLength(1));
    expect(slot.inspection.composer.text).toBe("идея и ещё");
  });

  it("в сайд-чате кнопки нет", async () => {
    const slot = render(saveAction, {}, {
      composer: { text: "x", scope: { kind: "side-chat", projectId: "p_1", parentThreadId: "thr_1", tabId: "t", childThreadId: null } },
    });
    await act(async () => {});
    expect(slot.queryByRole("button", { name: "Save Draft" })).toBeNull();
  });

  it("список перечитывается после переподключения", async () => {
    const slot = render(banner, {}, { composer: { text: "", scope: homeScope } });
    await slot.findAllByRole("button", { name: /^Send to Composer/ });
    const lists = () => slot.inspection.rpcCalls.filter((call) => call.method === "list").length;
    const before = lists();
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(lists()).toBe(before + 1));
  });

  it("провал чтения списка оставляет секцию пустой без падения", async () => {
    const rpc = {
      ...memoryRpc(DRAFTS),
      list: () => {
        throw new Error("storage is down");
      },
    };
    const slot = render(banner, {}, { rpc, composer: { scope: homeScope } });
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "list")).toBe(true));
    await act(async () => {});
    expect(slot.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("автосохранение композера", () => {
  const autosaveCalls = (slot: ReturnType<typeof render>) =>
    slot.inspection.rpcCalls.filter((call) => call.method === "autosave").map((call) => call.input);

  /** Набор без пауз: символ за символом, каждые `step` мс модельного времени. */
  const type = async (slot: ReturnType<typeof render>, text: string, step: number) => {
    for (let length = 1; length <= text.length; length += 1) {
      await slot.behavior.setComposerText(text.slice(0, length));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step);
      });
    }
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("пауза в наборе отправляет набранное в слот с местом композера", async () => {
    const slot = render(saveAction, {}, { composer: { text: "", scope: threadScope } });
    await slot.behavior.setComposerText("длинный запрос");
    expect(autosaveCalls(slot)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(autosaveCalls(slot)).toEqual([{ text: "длинный запрос", place: THREAD_1 }]);
  });

  it("безостановочный набор пишется, не дожидаясь паузы", async () => {
    const slot = render(saveAction, {}, { composer: { text: "", scope: homeScope } });
    await type(slot, "пишу и пишу без остановки", 300);
    const calls = autosaveCalls(slot);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((input) => (input as { place: Place }).place.threadId === null)).toBe(true);
  });

  it("опустевший композер гасит слот сразу, без ожидания паузы", async () => {
    const slot = render(saveAction, {}, { composer: { text: "уйдёт в отправку", scope: threadScope } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await slot.behavior.setComposerText("");
    expect(autosaveCalls(slot).at(-1)).toEqual({ text: "", place: THREAD_1 });
  });

  it("текст, найденный в композере при открытии, уходит в слот", async () => {
    const slot = render(saveAction, {}, { composer: { text: "bb вернул сам", scope: threadScope } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(autosaveCalls(slot)).toEqual([{ text: "bb вернул сам", place: THREAD_1 }]);
  });

  it("пустой композер при открытии не пишет в слот ничего", async () => {
    const slot = render(saveAction, {}, { composer: { text: "", scope: threadScope } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(autosaveCalls(slot)).toHaveLength(0);
  });

  it("выключенная настройка не шлёт ни одной записи", async () => {
    const slot = render(saveAction, {}, { composer: { text: "набрано", scope: threadScope }, settings: { autosave: false } });
    await slot.behavior.setComposerText("набрано ещё");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await slot.behavior.setComposerText("");
    expect(autosaveCalls(slot)).toHaveLength(0);
  });

  it("смена треда отменяет отложенную запись — чужой текст в новый слот не уезжает", async () => {
    const slot = render(saveAction, {}, { composer: { text: "", scope: threadScope } });
    await slot.behavior.setComposerText("в первом треде");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await slot.behavior.setComposerScope({ kind: "thread", threadId: "thr_2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const threads = autosaveCalls(slot).map((input) => (input as { place: Place }).place.threadId);
    expect(threads).not.toContain("thr_1");
  });

  it("провал записи в слот не выносится тостом — слот это подстраховка, а не отправка", async () => {
    const rpc = {
      ...memoryRpc(DRAFTS),
      autosave: () => {
        throw new Error("storage is down");
      },
    };
    toastError.mockClear();
    const slot = render(saveAction, {}, { composer: { text: "набрано", scope: threadScope }, rpc });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(slot.queryAllByRole("button")).toHaveLength(1);
  });
});

describe("размер текста карточки", () => {
  // Корень разметки bb сам ставит text-sm leading-relaxed: размер должен лечь на него, а не на обёртку.
  const markdownClass = async (option: string) => {
    const slot = render(banner, {}, { settings: { cardTextSize: option }, composer: { scope: homeScope } });
    const [card] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    return card!.querySelector<HTMLElement>("[data-testid=bb-markdown]")!.className;
  };

  it("по умолчанию — 13 px, строка 18 px", async () => {
    const className = await markdownClass(CARD_TEXT_OPTIONS[0]);
    expect(className).toContain("text-[13px]");
    expect(className).toContain("leading-[18px]");
  });

  it("средний вариант — 12 px, строка плотнее — 16 px", async () => {
    const className = await markdownClass(CARD_TEXT_OPTIONS[1]);
    expect(className).toContain("text-[12px]");
    expect(className).toContain("leading-[16px]");
  });

  it("мелкий вариант — 11 px, строка 14 px", async () => {
    const className = await markdownClass(CARD_TEXT_OPTIONS[2]);
    expect(className).toContain("text-[11px]");
    expect(className).toContain("leading-[14px]");
  });
});

describe("ряд карточек", () => {
  it("прокручивается вбок без видимой полосы прокрутки", async () => {
    const slot = render(banner, {}, { composer: { scope: homeScope } });
    const [card] = await slot.findAllByRole("button", { name: /^Send to Composer/ });
    const row = card!.closest("[aria-busy]")!;
    expect(row.className).toContain("overflow-x-auto");
    expect(row.className).toContain("[scrollbar-width:none]");
  });
});
