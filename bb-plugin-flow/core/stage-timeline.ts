// Этапы прогона треда на шкале времени — то, что Flow отдаёт другим плагинам: Token Usage Analytics ставит по ним
// отметки под графиком сессии. Чистое ядро: рисунок значка по имени подставляет сервер.
import { stageKindOf } from "../lib/stage-constants";
import { stageIconName } from "../lib/stage-icon-names";
import type { FlowProgress, TimelineStage, WorkStage } from "../shared/contract";

/** Этап шкалы до подстановки рисунка: свой значок владельца, если выбран, и запасной — по виду и шагам, как на странице Flow. */
export type TimelineStageDraft = Omit<TimelineStage, "glyph"> & { icon: string | undefined; fallbackIcon: string };

type Track = FlowProgress["stages"][string];

/** Проходы этапа по порядку: закрытые прошлые и нынешний, если он начат; `to: null` — нынешний ещё идёт. */
const passesOf = (track: Track): TimelineStage["passes"] => [
  ...(track.passes ?? []),
  ...(track.startedAt === undefined ? [] : [{ from: track.startedAt, to: track.finishedAt ?? null }]),
];

/** Этапы flow с хотя бы одним проходом, в порядке flow. */
export const stageTimeline = (progress: FlowProgress, stages: readonly WorkStage[]): TimelineStageDraft[] =>
  stages.flatMap((stage) => {
    const track = progress.stages[stage.id] ?? {};
    const passes = passesOf(track);
    if (passes.length === 0) return [];
    const fallbackIcon = stageIconName({ kind: stageKindOf(stage), automation: stage.automation !== undefined });
    return [{ id: stage.id, name: stage.name, icon: stage.icon, fallbackIcon, passes }];
  });
