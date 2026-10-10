// Блок ```mermaid в тексте брифа и демонстрации — диаграммой. Отрисовка — та же, что у Kasimov в MD Opener
// (createMermaidRenderer, packages/kasimov/kasimov.js): строгий режим, плотная раскладка ELK с откатом на встроенную.
// Библиотека лежит в бандле плагина, а выполняется только при первой диаграмме; тема — тёмная или светлая, как у bb,
// и переключается вместе с ним. Диаграмма с ошибкой
// остаётся исходником моноширинным блоком. Спаны, а не div: текст стоит и внутри кнопки варианта.
import { useEffect, useState } from "react";

import { useHostDark } from "./use-host-dark";

export type RenderMermaid = (source: string, dark: boolean) => Promise<string>;

let seq = 0;

const drawOnce = async (source: string, dark: boolean): Promise<string> => {
  const { default: mermaid } = await import("mermaid");
  const draw = async (extra: object) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      flowchart: { rankSpacing: 12, nodeSpacing: 20, padding: 8, subGraphTitleMargin: { top: 8, bottom: 16 } },
      ...extra,
    });
    seq += 1;
    return (await mermaid.render(`flow-mmd-${seq}`, source)).svg;
  };
  return draw({ layout: "elk", elk: { mergeEdges: true, nodePlacementStrategy: "BRANDES_KOEPF" } }).catch(() => draw({}));
};

/** Очередь отрисовок: mermaid держит настройки глобально, и две диаграммы разом перебивали бы друг другу тему. */
let queue: Promise<unknown> = Promise.resolve();

export const renderMermaid: RenderMermaid = (source, dark) => {
  const drawn = queue.then(() => drawOnce(source, dark));
  queue = drawn.catch(() => undefined);
  return drawn;
};

type Drawn = { kind: "pending" } | { kind: "svg"; svg: string } | { kind: "failed" };

export function MermaidDiagram({ source, render = renderMermaid }: { source: string; render?: RenderMermaid }) {
  const dark = useHostDark();
  const [drawn, setDrawn] = useState<Drawn>({ kind: "pending" });
  useEffect(() => {
    let alive = true;
    render(source, dark).then(
      (svg) => alive && setDrawn({ kind: "svg", svg }),
      () => alive && setDrawn({ kind: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [source, dark, render]);
  return drawn.kind === "svg" ? (
    <span data-mermaid className="my-2 block max-w-full overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
  ) : (
    <span data-mermaid-source className="my-2 block overflow-x-auto whitespace-pre rounded-md bg-state-hover px-3 py-2 font-mono text-xs">
      {source}
    </span>
  );
}
