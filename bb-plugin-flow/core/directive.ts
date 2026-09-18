// Строки `::decision{id="…"}` и `::command{id="…"}` собираются на бэкенде и
// разбираются на фронте — здесь, в одном месте, чтобы стороны не разошлись в
// кавычках и префиксе.

export const DECISION_ID_PREFIX = "dec_";

export const directiveLine = (id: string): string => `::decision{id="${id}"}`;

export const readDecisionId = (attributes: Readonly<Record<string, string>>) => readPrefixed(attributes, DECISION_ID_PREFIX);

export const COMMAND_ID_PREFIX = "cmd_";

export const commandDirectiveLine = (id: string): string => `::command{id="${id}"}`;

const readPrefixed = (attributes: Readonly<Record<string, string>>, prefix: string): { kind: "ok"; id: string } | { kind: "invalid" } => {
  const id = attributes.id ?? "";
  return id.length > prefix.length && id.startsWith(prefix) && !/\s/.test(id) ? { kind: "ok", id } : { kind: "invalid" };
};

export const readCommandId = (attributes: Readonly<Record<string, string>>) => readPrefixed(attributes, COMMAND_ID_PREFIX);
