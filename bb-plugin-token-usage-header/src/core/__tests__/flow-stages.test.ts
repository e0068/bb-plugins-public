import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { flowLaneChips, flowStageMarks, flowStageSchema, placeFlowMarks, type FlowStage } from "../flow-stages";

const UNIT = 60;
const CLOSED = { unit: UNIT, live: false };
const LIVE = { unit: UNIT, live: true };
const T0 = Date.parse("2026-10-08T10:00:00.000Z");
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();
const GLYPH: FlowStage["glyph"] = [["path", { d: "M0 0", strokeWidth: 1.5 }]];

/** Columns of one minute each from `minutes`, with an optional collapsed gap column — the shape computeDisplayBins produces. */
const columns = (...spec: Array<[minute: number, gapUnits: number]>) => spec.map(([minute, gapUnits]) => ({ t: at(minute), gapUnits }));

const stage = (id: string, passes: FlowStage["passes"]): FlowStage => ({ id, name: id, glyph: GLYPH, passes });

describe("flowStageSchema", () => {
  it("accepts Flow's answer and drops fields it doesn't know", () => {
    const parsed = flowStageSchema.parse({ id: "spec", name: "Spec", glyph: GLYPH, passes: [{ from: at(0), to: null }], extra: 1 });
    expect(parsed).toEqual({ id: "spec", name: "Spec", glyph: GLYPH, passes: [{ from: at(0), to: null }] });
  });

  it("rejects a glyph that isn't tag/attribute pairs", () => {
    expect(flowStageSchema.safeParse({ id: "spec", name: "Spec", glyph: ["path"], passes: [] }).success).toBe(false);
  });
});

describe("flowStageMarks", () => {
  it("one mark per pass, numbered within its stage, ordered by start", () => {
    const marks = flowStageMarks([
      stage("prototype", [
        { from: at(0), to: at(10) },
        { from: at(20), to: at(30) },
      ]),
      stage("demo", [{ from: at(10), to: at(20) }]),
    ]);
    expect(marks.map(({ stageId, from, pass, of }) => ({ stageId, from, pass, of }))).toEqual([
      { stageId: "prototype", from: at(0), pass: 1, of: 2 },
      { stageId: "demo", from: at(10), pass: 1, of: 1 },
      { stageId: "prototype", from: at(20), pass: 2, of: 2 },
    ]);
  });
});

describe("placeFlowMarks", () => {
  const marksOf = (passes: FlowStage["passes"]) => flowStageMarks([stage("s", passes)]);

  it("start and end land in the columns whose windows hold them", () => {
    const [placed] = placeFlowMarks(columns([0, 1], [1, 1], [2, 1], [3, 1]), marksOf([{ from: at(1.5), to: at(2.2) }]), CLOSED);
    expect(placed).toMatchObject({ start: 1, end: 2 });
  });

  it("a running pass reaches the last column", () => {
    const [placed] = placeFlowMarks(columns([0, 1], [1, 1], [2, 1]), marksOf([{ from: at(0.5), to: null }]), CLOSED);
    expect(placed).toMatchObject({ start: 0, end: 2 });
  });

  it("a collapsed gap column holds every moment of its run", () => {
    const [placed] = placeFlowMarks(columns([0, 1], [1, 5], [6, 1]), marksOf([{ from: at(3), to: at(6.5) }]), CLOSED);
    expect(placed).toMatchObject({ start: 1, end: 2 });
  });

  it("a moment inside a dropped gap moves to the next column on the right", () => {
    const [placed] = placeFlowMarks(columns([0, 1], [10, 1]), marksOf([{ from: at(4), to: at(5) }]), CLOSED);
    expect(placed).toMatchObject({ start: 1, end: 1 });
  });

  it("an unparseable timestamp drops the mark instead of throwing", () => {
    expect(placeFlowMarks(columns([0, 1]), marksOf([{ from: "not a date", to: null }]), CLOSED)).toEqual([]);
  });

  it("no columns — nothing to place", () => {
    expect(placeFlowMarks([], marksOf([{ from: at(0), to: null }]), LIVE)).toEqual([]);
  });

  it("a pass lying wholly outside the chart — another thread's part of a handed-over run — gets no mark", () => {
    const cols = columns([10, 1], [11, 1], [12, 1]);
    expect(placeFlowMarks(cols, marksOf([{ from: at(0), to: at(5) }]), LIVE)).toEqual([]);
    expect(placeFlowMarks(cols, marksOf([{ from: at(20), to: at(25) }]), LIVE)).toEqual([]);
  });

  it("a running pass that began after the last column stays only while the session is working", () => {
    const cols = columns([0, 1], [1, 1]);
    const running = marksOf([{ from: at(5), to: null }]);
    expect(placeFlowMarks(cols, running, LIVE)).toMatchObject([{ start: 1, end: 1 }]);
    expect(placeFlowMarks(cols, running, CLOSED)).toEqual([]);
  });

  it("a pass that only partly overlaps the chart is clamped to its edge", () => {
    const [placed] = placeFlowMarks(columns([10, 1], [11, 1], [12, 1]), marksOf([{ from: at(5), to: at(11.5) }]), CLOSED);
    expect(placed).toMatchObject({ start: 0, end: 1 });
  });

  it("start never passes end, both stay inside the chart, and every kept pass overlaps it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: -30, max: 90 }),
        fc.option(fc.integer({ min: -30, max: 90 }), { nil: null }),
        (gaps, fromMin, toMin) => {
          const starts = gaps.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + gaps[i - 1]!], []);
          const cols = starts.map((minute, i) => ({ t: at(minute), gapUnits: gaps[i]! }));
          const placed = placeFlowMarks(cols, marksOf([{ from: at(fromMin), to: toMin === null ? null : at(toMin) }]), CLOSED);
          const chartEnd = starts[starts.length - 1]! + gaps[gaps.length - 1]!;
          const overlaps = (toMin === null || toMin >= 0) && fromMin < chartEnd;
          return placed.length === (overlaps ? 1 : 0) && placed.every((p) => p.start >= 0 && p.start <= p.end && p.end < cols.length);
        },
      ),
    );
  });
});

describe("flowLaneChips", () => {
  const cols = columns([0, 1], [1, 1], [2, 1], [3, 1], [4, 1]);
  const place = (stages: FlowStage[]) => placeFlowMarks(cols, flowStageMarks(stages), CLOSED);
  const shape = (stages: FlowStage[]) =>
    flowLaneChips(place(stages)).map((chip) => ({ start: chip.start, end: chip.end, reach: chip.reach, stages: chip.marks.map((p) => p.mark.stageId) }));

  it("one chip per pass, stretched from its start column to its end column", () => {
    expect(shape([stage("a", [{ from: at(0.5), to: at(2.5) }]), stage("b", [{ from: at(3.2), to: at(4.5) }])])).toEqual([
      { start: 0, end: 2, reach: 2, stages: ["a"] },
      { start: 3, end: 4, reach: 4, stages: ["b"] },
    ]);
  });

  it("passes starting in one column share one chip, the first one leads it", () => {
    expect(shape([stage("a", [{ from: at(1.1), to: at(1.3) }]), stage("b", [{ from: at(1.4), to: at(3.5) }]), stage("c", [{ from: at(4.1), to: at(4.5) }])])).toEqual([
      { start: 1, end: 3, reach: 3, stages: ["a", "b"] },
      { start: 4, end: 4, reach: 4, stages: ["c"] },
    ]);
  });

  it("a chip is drawn short of the column where the next chip starts, but still reaches where its pass ended", () => {
    expect(shape([stage("a", [{ from: at(0.5), to: at(2.5) }]), stage("b", [{ from: at(2.6), to: at(4.5) }])])).toEqual([
      { start: 0, end: 1, reach: 2, stages: ["a"] },
      { start: 2, end: 4, reach: 4, stages: ["b"] },
    ]);
  });

  it("chips never overlap, each holds every pass starting in its column, and every pass sits in exactly one chip — whatever order the passes come in", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 49 }), fc.integer({ min: 0, max: 20 })), { maxLength: 10 }).chain((spans) =>
          fc.shuffledSubarray(place(spans.map(([from, length], i) => stage(`s${i}`, [{ from: at(from / 10), to: at((from + length) / 10) }]))), {
            minLength: spans.length,
          }),
        ),
        (placed) => {
          const chips = flowLaneChips(placed);
          const disjoint = chips.every((chip, i) => chip.start <= chip.end && chip.end <= chip.reach && (i === 0 || chips[i - 1]!.end < chip.start));
          const grouped = chips.every((chip) => chip.marks.length > 0 && chip.marks.every((p) => p.start === chip.start));
          return disjoint && grouped && chips.flatMap((chip) => chip.marks).length === placed.length;
        },
      ),
    );
  });
});
