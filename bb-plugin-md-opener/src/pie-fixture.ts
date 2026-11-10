// Разметка круговой диаграммы, как её кладёт в чат bb 0.49 (mermaid 11, pieDiagram), — для тестов.
// Дольки рисуются только у секций от процента, легенда — у всех: `drawn` — какие секции получили дольку.

type PieOptions = { id?: string; drawn?: readonly string[] };

export const pieSvg = (labels: readonly string[], { id = "bb-mermaid-msg-1", drawn = labels }: PieOptions = {}): string => `
<svg id="${id}" aria-roledescription="pie">
  <g transform="translate(225,225)">
    <g>
      <circle class="pieOuterCircle"></circle>
      ${drawn.map((l) => `<path class="pieCircle" fill="rgb(38, 38, 38)" data-slice="${l}"></path>`).join("")}
      ${drawn.map(() => `<text class="slice">33%</text>`).join("")}
    </g>
    <text class="pieTitleText">Видимое в main</text>
    ${labels.map((l) => `<g class="legend" data-legend="${l}"><rect style="fill: rgb(38, 38, 38); stroke: rgb(38, 38, 38);"></rect><text>${l}</text></g>`).join("")}
  </g>
</svg>`;

/** Блок-схема bb: её узлы, рёбра и даже группа legend палитру не касаются. */
export const FLOWCHART_SVG = `
<svg id="bb-mermaid-msg-2" aria-roledescription="flowchart-v2">
  <g><g class="node"><rect></rect></g><path class="flowchart-link"></path><g class="legend"><rect></rect></g></g>
</svg>`;
