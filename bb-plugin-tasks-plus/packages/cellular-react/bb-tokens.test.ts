// @vitest-environment node
// Обещания моста bb → Cellular: каждый themed-канал контракта --cell-* получает
// значение из токенов bb, литеральных цветов в мосте нет, мост побеждает дефолты kit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const here = new URL(".", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, here), "utf8");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const kitCss = withoutComments(read("../cellular-kit/vendor/components.css"));
const bridge = withoutComments(read("./bb-tokens.css"));
const themedChannels = [...new Set([...kitCss.matchAll(/--cell-([a-z-]+?)-default:/g)].map((m) => m[1]))];

describe("мост bb-tokens.css", () => {
  it("кормит каждый themed-канал --cell-* из components.css kit", () => {
    expect(themedChannels.length).toBeGreaterThan(0);
    const missing = themedChannels.filter((ch) => !new RegExp(`--cell-${ch}\\s*:`).test(bridge));
    expect(missing).toEqual([]);
  });

  it("не содержит ни одного цвета литералом: hex, rgb(), rgba(), hsl()", () => {
    expect(bridge.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)).toBeNull();
  });

  it("берёт акцент и заливку меню kit из токенов bb", () => {
    expect(bridge).toMatch(/--cl-kit-accent:\s*var\(--/);
    expect(bridge).toMatch(/--cl-kit-menu-fill:\s*var\(--/);
  });

  it("в styles.css подключён после components.css kit — иначе :root kit перекрывает мост", () => {
    const styles = read("./styles.css");
    const kitAt = styles.indexOf("components.css");
    const bridgeAt = styles.indexOf("bb-tokens.css");
    expect(kitAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeGreaterThan(kitAt);
  });
});
