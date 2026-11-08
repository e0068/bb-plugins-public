// Директива задачи посреди фразы в ответе агента — место под чип. bb узнаёт
// `::task{…}` только отдельной строкой; посреди фразы она остаётся текстом
// внутри абзаца, который принадлежит React bb. Узлы React не двигаются и не
// удаляются: текстовый узел bb укорачивается до начала первой директивы, а
// следом за ним встают свои узлы — пустой span под чип и остаток текста.
// Когда bb перепишет свой узел (стрим дописал абзац), разрез устаревает:
// свои узлы уходят, и узел режется заново, с теми же span под чипы.
import { findInlineTaskDirectives } from "../../shared/inline-task-directive.js";

export const CHIP_HOST_ATTRIBUTE = "data-tasks-inline-chip";

/** Ответ агента; у сообщения владельца группа лежит внутри колонки, а не на ней. */
const MESSAGE_SELECTOR = "[data-message-column].group\\/message";
/** Код показывает синтаксис директивы, а свой чип текстом не режется. */
const SKIP_SELECTOR = `code, pre, [${CHIP_HOST_ATTRIBUTE}]`;
const MARKER = "::task{";

/** Место под чип: пустой span в абзаце bb и директива, которую он заменил. */
export type ChipHost = {
  readonly id: number;
  readonly element: HTMLElement;
  readonly key: string;
  readonly source: string;
};

/** Разрезанный текстовый узел bb: что в нём оставлено и что вставлено следом. */
type Cut = {
  readonly text: Text;
  /** Абзац, в котором резали: по нему разрез узнаёт свои места, когда bb сменит текстовый узел. */
  readonly parent: Node;
  readonly original: string;
  readonly kept: string;
  readonly added: readonly Node[];
  readonly hosts: readonly ChipHost[];
};

const isStale = (cut: Cut): boolean => !cut.text.isConnected || cut.text.data !== cut.kept;

/** Убрать свои узлы; узел bb, который никто не переписал, получает исходный текст. */
const undo = (cut: Cut): void => {
  for (const node of cut.added) node.parentNode?.removeChild(node);
  if (cut.text.isConnected && cut.text.data === cut.kept) cut.text.data = cut.original;
};

const directiveTexts = (messages: Iterable<Element>): readonly Text[] =>
  Array.from(messages).flatMap((message) => {
    const walker = message.ownerDocument.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeValue?.includes(MARKER) === true && node.parentElement?.closest(SKIP_SELECTOR) === null
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    const texts: Text[] = [];
    while (walker.nextNode() !== null) texts.push(walker.currentNode as Text);
    return texts;
  });

/** Ответы агента, которые задела мутация: тот, внутри которого она, и пришедшие с ней целиком. */
const touchedMessages = (record: MutationRecord): readonly Element[] => {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  // Свой чип перерисовывается в своём месте — ленту это не меняет.
  if (target === null || !target.isConnected || target.closest(`[${CHIP_HOST_ATTRIBUTE}]`) !== null) return [];
  const around = target.closest(MESSAGE_SELECTOR);
  const arrived = Array.from(record.addedNodes).flatMap((node) =>
    node instanceof Element
      ? [...(node.matches(MESSAGE_SELECTOR) ? [node] : []), ...Array.from(node.querySelectorAll(MESSAGE_SELECTOR))]
      : [],
  );
  return around === null ? arrived : [around, ...arrived];
};

const sameHosts = (left: readonly ChipHost[], right: readonly ChipHost[]): boolean =>
  left.length === right.length && left.every((host, index) => host === right[index]);

/**
 * Следит за лентой под `root` и сообщает места под чипы при каждом их
 * изменении. Возвращает отписку, которая возвращает абзацам исходный текст.
 */
export const watchInlineTaskDirectives = (
  root: HTMLElement,
  onHosts: (hosts: readonly ChipHost[]) => void,
): (() => void) => {
  const document = root.ownerDocument;
  let nextId = 0;
  let cuts: readonly Cut[] = [];
  let reported: readonly ChipHost[] = [];

  /**
   * Место под директиву. Прежнее место с тем же ключом из того же абзаца
   * забирается из `pool` по порядку: bb, дописывая абзац, меняет свой
   * текстовый узел на новый, и без этого чип собирался бы и грузил задачу
   * заново на каждом токене стрима.
   */
  const hostFor = (key: string, source: string, pool: ChipHost[]): ChipHost => {
    const index = pool.findIndex((host) => host.key === key);
    const [reused] = index < 0 ? [] : pool.splice(index, 1);
    if (reused !== undefined) return reused;
    const element = document.createElement("span");
    element.setAttribute(CHIP_HOST_ATTRIBUTE, "");
    return { id: nextId++, element, key, source };
  };

  const cut = (text: Text, pool: ChipHost[]): readonly Cut[] => {
    const original = text.data;
    const found = findInlineTaskDirectives(original);
    const [first] = found;
    const parent = text.parentNode;
    if (first === undefined || parent === null) return [];
    const pieces = found.map((directive, index) => ({
      host: hostFor(directive.key, original.slice(directive.start, directive.end), pool),
      tail: original.slice(directive.end, found[index + 1]?.start ?? original.length),
    }));
    const added = pieces.flatMap(({ host, tail }) =>
      tail === "" ? [host.element] : [host.element, document.createTextNode(tail)],
    );
    const kept = original.slice(0, first.start);
    text.data = kept;
    text.after(...added);
    return [{ text, parent, original, kept, added, hosts: pieces.map(({ host }) => host) }];
  };

  /** Проверить разрезы и найти новые директивы только в заданных ответах агента. */
  const scan = (messages: Iterable<Element>) => {
    const stale = cuts.filter(isStale);
    stale.forEach(undo);
    const pools = new Map<Node | null, ChipHost[]>();
    for (const entry of stale) pools.set(entry.parent, [...(pools.get(entry.parent) ?? []), ...entry.hosts]);
    const fresh = directiveTexts(messages).flatMap((text) => cut(text, pools.get(text.parentNode) ?? []));
    cuts = [...cuts.filter((entry) => !stale.includes(entry)), ...fresh];
    const hosts = cuts.flatMap((entry) => entry.hosts);
    if (!sameHosts(hosts, reported)) {
      reported = hosts;
      onHosts(hosts);
    }
  };

  // Вся лента проходится один раз, при старте. Дальше работа есть, только
  // когда лента меняется, и обходятся лишь задетые ответы агента — на стриме
  // это один дописываемый ответ. Мутации стрима идут пачками на каждый токен,
  // поэтому задетые ответы копятся и обходятся не чаще раза в кадр.
  let frame: number | null = null;
  const touched = new Set<Element>();
  const observer = new MutationObserver((records) => {
    for (const message of records.flatMap(touchedMessages)) touched.add(message);
    const hasStale = cuts.some(isStale);
    if (frame !== null || (touched.size === 0 && !hasStale)) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      // Ответ, убранный из ленты до кадра, не режется: чипу вне документа не место.
      const messages = [...touched].filter((message) => message.isConnected);
      touched.clear();
      scan(messages);
    });
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  scan(Array.from(root.querySelectorAll(MESSAGE_SELECTOR)));

  return () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    cuts.forEach(undo);
    cuts = [];
  };
};
