import { describe, expect, it } from "vitest";

import { isCatalogResponse, type CatalogResponse } from "./index.js";

const catalog = (automations: CatalogResponse["automations"]): CatalogResponse => ({ automations, triggers: [], conditions: [], actions: [] });

describe("шаги автоматизации в каталоге", () => {
  it("каталог с шагами и без шагов проходит проверку формы", () => {
    expect(isCatalogResponse(catalog([{ id: "a", name: "A", enabled: true, steps: ["Open a PR", "Merge"] }]))).toBe(true);
    expect(isCatalogResponse(catalog([{ id: "a", name: "A", enabled: true }]))).toBe(true);
  });

  it("шаги не строками — не каталог", () => {
    expect(isCatalogResponse({ ...catalog([]), automations: [{ id: "a", name: "A", enabled: true, steps: [1] }] })).toBe(false);
  });
});
