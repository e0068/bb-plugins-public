// Flow треда в шапке файла задачи: по нему Tasks+ показывает в карточке, по какому flow шла задача, и ведёт ссылкой
// на страницу flow. Tasks+ спросить Flow не может, поэтому рядом с id лежит и название — то, что было на момент прогона.

export type TaskFlow = { readonly id: string; readonly name: string };

/** Шапка в начале файла, после необязательного BOM — так же её читает Tasks+. */
const HEAD = /^(﻿?)---(\r?\n)([\s\S]*?)\r?\n---/;

/** Строки шапки, разложенные на блок `flow:` — саму строку и строки с отступом под ней — и все остальные. */
const splitFlow = (lines: readonly string[]): { rest: string[]; block: string[] } =>
  lines.reduce<{ rest: string[]; block: string[]; inFlow: boolean }>(
    ({ rest, block, inFlow }, line) => {
      if (/^flow:/.test(line)) return { rest, block: [line], inFlow: true };
      if (inFlow && /^\s/.test(line)) return { rest, block: [...block, line], inFlow };
      return { rest: [...rest, line], block, inFlow: false };
    },
    { rest: [], block: [], inFlow: false },
  );

/** Скаляр YAML строкой: в двойных кавычках — по правилам JSON, в одинарных — с удвоенной кавычкой, без кавычек — как есть. */
const scalar = (raw: string): string => {
  const value = raw.trim();
  if (/^".*"$/.test(value)) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  return /^'.*'$/.test(value) ? value.slice(1, -1).replace(/''/g, "'") : value;
};

/** Поле блока `flow` по имени; нет — `undefined`. */
const field = (block: readonly string[], name: string): string | undefined => {
  const match = block.map((line) => new RegExp(`^\\s+${name}:(.*)$`).exec(line)).find((found): found is RegExpExecArray => found !== null);
  return match === undefined ? undefined : scalar(match[1]!);
};

const sameFlow = (block: readonly string[], flow: TaskFlow): boolean => field(block, "id") === flow.id && field(block, "name") === flow.name;

/**
 * Шапка с блоком `flow` последним полем: прежний блок снимается, где бы ни стоял. Тот же flow уже записан — в любом
 * месте шапки и в любой записи строк, в том числе в той, что оставляет Tasks+, переписывая шапку, — файл возвращается
 * как есть. Название — строкой JSON, это валидная YAML-строка при любых символах. Файл без шапки возвращается как есть.
 */
export const stampFlow = (markdown: string, flow: TaskFlow): string => {
  const head = HEAD.exec(markdown);
  if (head === null) return markdown;
  const [whole, bom, eol] = [head[0], head[1]!, head[2]!];
  const { rest, block } = splitFlow((head[3] ?? "").split(/\r?\n/));
  if (sameFlow(block, flow)) return markdown;
  const stamped = ["flow:", `  id: ${flow.id}`, `  name: ${JSON.stringify(flow.name)}`];
  return `${bom}---${eol}${[...rest, ...stamped].join(eol)}${eol}---${markdown.slice(whole.length)}`;
};
