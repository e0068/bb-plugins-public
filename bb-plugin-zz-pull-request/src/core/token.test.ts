import { describe, expect, it } from "vitest";
import { chooseToken } from "./token";

describe("chooseToken", () => {
  it("явная настройка приоритетнее gh", () => {
    expect(chooseToken("from-setting", "from-gh")).toBe("from-setting");
  });

  it("нет настройки — берём gh", () => {
    expect(chooseToken(undefined, "from-gh")).toBe("from-gh");
    expect(chooseToken("", "from-gh")).toBe("from-gh");
    expect(chooseToken("   ", "from-gh")).toBe("from-gh");
  });

  it("отбрасывает пробелы и перевод строки из gh", () => {
    expect(chooseToken(undefined, "tok\n")).toBe("tok");
  });

  it("нет ни того, ни другого — null", () => {
    expect(chooseToken(undefined, null)).toBeNull();
    expect(chooseToken("  ", "")).toBeNull();
  });
});
