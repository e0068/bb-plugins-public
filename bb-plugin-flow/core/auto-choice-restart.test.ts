// Тумблер «Очищать контекст после автоматического выбора flow»: включён — тред с «Автоматически» после выбора flow
// начинается заново, выключен — не очищается никогда и до выбора ничего не прячет.
import { describe, expect, it } from "vitest";

import { clearsContextAfterAutoChoice, limitsBeforeChoice, restartsAfterChoice } from "./skill-scope";

const LIMITED = [{ limitSkills: true, limitAgents: true }, {}] as const;

describe("тумблер очистки контекста после автоматического выбора flow", () => {
  it("нет поля — включён, как было до тумблера", () => {
    expect(clearsContextAfterAutoChoice({})).toBe(true);
    expect(clearsContextAfterAutoChoice({ clearContextAfterAutoChoice: true })).toBe(true);
    expect(clearsContextAfterAutoChoice({ clearContextAfterAutoChoice: false })).toBe(false);
  });

  it("включён — до выбора прячется то, что прячет хоть один flow", () => {
    expect(limitsBeforeChoice({ flows: LIMITED })).toEqual({ skills: true, agents: true });
  });

  it("выключен — до выбора не прячется ничего: очистки не будет, и урезанная сессия так бы и осталась урезанной", () => {
    expect(limitsBeforeChoice({ flows: LIMITED, clearContextAfterAutoChoice: false })).toEqual({ skills: false, agents: false });
  });

  it("включён — после выбора любого flow тред начинается заново, даже если ни один flow ничего не прятал", () => {
    expect(restartsAfterChoice({ clears: true, chosen: true, limitedBeforeChoice: false })).toBe(true);
  });

  it("выключен — выбор flow тред не очищает", () => {
    expect(restartsAfterChoice({ clears: false, chosen: true, limitedBeforeChoice: false })).toBe(false);
  });

  it("отказ от flow очищает только сессию, начатую урезанной: иначе навыки не вернутся", () => {
    expect(restartsAfterChoice({ clears: true, chosen: false, limitedBeforeChoice: false })).toBe(false);
    expect(restartsAfterChoice({ clears: true, chosen: false, limitedBeforeChoice: true })).toBe(true);
  });

  it("сессия стартовала урезанной до того, как тумблер выключили, — тред всё равно начинается заново, чтобы вернуть навыки", () => {
    expect(restartsAfterChoice({ clears: false, chosen: true, limitedBeforeChoice: true })).toBe(true);
  });
});
