// @vitest-environment node
// What counts as code here is what the engine draws as code (renderBody and inlineDOM in ../kasimov/kasimov.js).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { resolveImagePaths } from "./image-paths";

const to = (src: string) => `/img?src=${encodeURIComponent(src)}`;

describe("абсолютный путь картинки в тексте", () => {
  it("уходит в адрес резолвера, подпись и соседний текст остаются", () => {
    expect(resolveImagePaths("до ![Снимок](/a/b.png) после", to)).toBe("до ![Снимок](/img?src=%2Fa%2Fb.png) после");
  });

  it("резолвер ответил null — путь остаётся как написан", () => {
    expect(resolveImagePaths("![x](/etc/a.png)", () => null)).toBe("![x](/etc/a.png)");
  });

  it("путь от корня дерева, путь в угловых скобках, адрес и //хост резолвер не слышат: движок спросит его сам или возьмёт адрес", () => {
    const seen: string[] = [];
    const text = "![a](docs/a.png) ![b](https://x.test/b.png) ![c](//x.test/c.png) ![d](data:image/png;base64,AA) ![e](</a b.png>)";
    expect(resolveImagePaths(text, (src) => (seen.push(src), to(src)))).toBe(text);
    expect(seen).toEqual([]);
  });

  it("несколько картинок в одной строке решаются по одной", () => {
    expect(resolveImagePaths("![a](/a.png) ![b](/b.png)", to)).toBe("![a](/img?src=%2Fa.png) ![b](/img?src=%2Fb.png)");
  });

  it("экранированная картинка остаётся текстом как написана", () => {
    expect(resolveImagePaths("\\![a](/a.png)", to)).toBe("\\![a](/a.png)");
  });
});

describe("код — как его рисует движок", () => {
  it("блок между строками с ``` остаётся как написан, при любом отступе ограды", () => {
    const text = "```md\n![a](/a.png)\n```\n- пункт\n    ```\n    ![b](/b.png)\n    ```\n![c](/c.png)";
    expect(resolveImagePaths(text, to)).toBe("```md\n![a](/a.png)\n```\n- пункт\n    ```\n    ![b](/b.png)\n    ```\n![c](/img?src=%2Fc.png)");
  });

  it("блок закрывает любая строка с ```, и после неё картинка снова решается", () => {
    expect(resolveImagePaths("````\n![a](/a.png)\n```\n![b](/b.png)", to)).toBe("````\n![a](/a.png)\n```\n![b](/img?src=%2Fb.png)");
  });

  it("картинка в обратных кавычках и в ~~~ движку картинка — решается", () => {
    expect(resolveImagePaths("`![a](/a.png)`\n~~~\n![b](/b.png)\n~~~", to)).toBe("`![a](/img?src=%2Fa.png)`\n~~~\n![b](/img?src=%2Fb.png)\n~~~");
  });

  it("резолвер, который отказывает всегда, не меняет ни одного текста", () => {
    fc.assert(fc.property(fc.string(), (text) => resolveImagePaths(text, () => null) === text));
  });
});
