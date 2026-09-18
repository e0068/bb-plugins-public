// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { COMMAND_ID_PREFIX, commandDirectiveLine, readCommandId } from "./directive";

describe("директива команды", () => {
  it("строка директивы разбирается обратно в тот же идентификатор", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]{1,24}$/), (tail) => {
        const id = `${COMMAND_ID_PREFIX}${tail}`;
        const line = commandDirectiveLine(id);
        const attr = /::command\{id="([^"]+)"\}/.exec(line)?.[1] ?? "";
        expect(readCommandId({ id: attr })).toEqual({ kind: "ok", id });
      }),
    );
  });

  it("идентификатор брифа, пустой и с пробелом не распознаются", () => {
    expect(readCommandId({ id: "dec_abc" })).toEqual({ kind: "invalid" });
    expect(readCommandId({ id: "cmd_" })).toEqual({ kind: "invalid" });
    expect(readCommandId({ id: "cmd_a b" })).toEqual({ kind: "invalid" });
    expect(readCommandId({})).toEqual({ kind: "invalid" });
  });
});
