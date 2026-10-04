import { describe, expect, it } from "vitest";
import { acceptedOf, isCallbackAnswer, isNotificationInput, toastCardOf, type NotificationInput, type NotificationToast } from "./index.js";

const BASE: NotificationInput = {
  source: "flow",
  kind: "awaiting",
  title: "Ждёт ответа",
  threadId: "thr_1",
  threadTitle: "Тред",
  url: null,
  dedupeKey: null,
};

const CARD: NotificationToast = {
  key: "thr_1:land",
  title: [{ kind: "route", route: "/plugins/flow/flows/f1", text: "Land" }, { kind: "text", text: " — готово" }],
  lines: [[{ kind: "thread", threadId: "thr_1", text: "Тред" }], [{ kind: "text", text: "PR — " }, { kind: "url", url: "https://github.com/o/r/pull/7", text: "PR #7" }]],
  actions: [
    { label: "View on GitHub", icon: "github", target: { kind: "url", url: "https://github.com/o/r/pull/7" } },
    { label: "Повторить", icon: "retry", target: { kind: "callback", path: "/notification-action", payload: { action: "retry", threadId: "thr_1" } } },
  ],
};

describe("isNotificationInput — открытый вход", () => {
  it("принимает любой плагин-источник и любой вид события", () => {
    expect(isNotificationInput({ ...BASE, source: "mail", kind: "letter-arrived" })).toBe(true);
  });

  it("принимает подписи, тон, карточку и умолчание тоста", () => {
    expect(isNotificationInput({ ...BASE, sourceName: "Flow", kindLabel: "Ждёт ответа", tone: "success", toast: CARD, toastByDefault: false })).toBe(true);
    expect(isNotificationInput({ ...BASE, toast: null })).toBe(true);
  });

  it("не принимает id плагина не той формы и зарезервированный вид", () => {
    expect(isNotificationInput({ ...BASE, source: "Mail Plugin" })).toBe(false);
    expect(isNotificationInput({ ...BASE, source: "" })).toBe(false);
    expect(isNotificationInput({ ...BASE, kind: "plugin-update" })).toBe(false);
    expect(isNotificationInput({ ...BASE, kind: "" })).toBe(false);
  });

  it("не принимает незнакомый тон, пустую подпись и не булево умолчание", () => {
    expect(isNotificationInput({ ...BASE, tone: "warning" })).toBe(false);
    expect(isNotificationInput({ ...BASE, sourceName: "" })).toBe(false);
    expect(isNotificationInput({ ...BASE, kindLabel: 1 })).toBe(false);
    expect(isNotificationInput({ ...BASE, toastByDefault: "yes" })).toBe(false);
  });

  it("не принимает карточку с незнакомым куском, иконкой или целью кнопки", () => {
    expect(isNotificationInput({ ...BASE, toast: { ...CARD, title: [{ kind: "bold", text: "x" }] } })).toBe(false);
    expect(isNotificationInput({ ...BASE, toast: { ...CARD, lines: [[{ kind: "url", text: "x" }]] } })).toBe(false);
    expect(isNotificationInput({ ...BASE, toast: { ...CARD, actions: [{ label: "x", icon: "rocket", target: { kind: "thread", threadId: "t" } }] } })).toBe(false);
    expect(isNotificationInput({ ...BASE, toast: { ...CARD, actions: [{ label: "x", icon: "link", target: { kind: "mail", to: "a" } }] } })).toBe(false);
    expect(isNotificationInput({ ...BASE, toast: { ...CARD, key: 3 } })).toBe(false);
  });

  it("путь кнопки-callback — путь входа источника: со слэша, без точек и чужого хоста", () => {
    const withPath = (path: string) => ({ ...BASE, toast: { ...CARD, actions: [{ label: "x", icon: "retry", target: { kind: "callback", path, payload: null } }] } });
    expect(isNotificationInput(withPath("/notification-action"))).toBe(true);
    expect(isNotificationInput(withPath("notification-action"))).toBe(false);
    expect(isNotificationInput(withPath("/../flow/x"))).toBe(false);
    expect(isNotificationInput(withPath("//evil.example/x"))).toBe(false);
  });
});

describe("acceptedOf — запись с заполненными умолчаниями", () => {
  it("без подписей, тона и умолчания тоста — id плагина, вид, info и тост включён", () => {
    expect(acceptedOf(BASE)).toMatchObject({ sourceName: "flow", kindLabel: "awaiting", tone: "info", toastByDefault: true });
  });

  it("присланные подписи, тон и умолчание остаются как есть", () => {
    expect(acceptedOf({ ...BASE, sourceName: "Flow", kindLabel: "Ждёт ответа", tone: "error", toastByDefault: false })).toMatchObject({
      sourceName: "Flow",
      kindLabel: "Ждёт ответа",
      tone: "error",
      toastByDefault: false,
    });
  });
});

describe("toastCardOf — карточка тоста записи", () => {
  it("приложенная карточка идёт как есть", () => {
    expect(toastCardOf(acceptedOf({ ...BASE, toast: CARD }))).toEqual(CARD);
  });

  it("без карточки — заголовок, строка треда и кнопка «К треду»", () => {
    expect(toastCardOf(acceptedOf(BASE))).toEqual({
      key: null,
      title: [{ kind: "text", text: "Ждёт ответа" }],
      lines: [[{ kind: "thread", threadId: "thr_1", text: "Тред" }]],
      actions: [{ label: "К треду", icon: "thread", target: { kind: "thread", threadId: "thr_1" } }],
    });
  });

  it("без карточки, со ссылкой — кнопка ссылки перед «К треду»; без названия треда строка называет его id", () => {
    const card = toastCardOf(acceptedOf({ ...BASE, threadTitle: null, url: "https://github.com/o/r/pull/7" }));
    expect(card.lines).toEqual([[{ kind: "thread", threadId: "thr_1", text: "thr_1" }]]);
    expect(card.actions.map((a) => a.target)).toEqual([
      { kind: "url", url: "https://github.com/o/r/pull/7" },
      { kind: "thread", threadId: "thr_1" },
    ]);
  });
});

describe("isCallbackAnswer", () => {
  it("годится только запись с текстом или null в message", () => {
    expect(isCallbackAnswer({ message: null })).toBe(true);
    expect(isCallbackAnswer({ message: "нет" })).toBe(true);
    expect(isCallbackAnswer({})).toBe(false);
    expect(isCallbackAnswer({ message: 1 })).toBe(false);
    expect(isCallbackAnswer([])).toBe(false);
  });
});
