// Значок этапа на странице Flow; сами имена значков по виду живут в lib/stage-icon-names — их берёт и сервер.
import { stageKindOf } from "../lib/stage-constants";
import { stageIconName } from "../lib/stage-icon-names";
import type { WorkStage } from "../shared/contract";

export { AUTOMATION_ICON, KIND_ICONS, SKILL_ICON } from "../lib/stage-icon-names";

/** Значок этапа по его виду — то же правило, что у баннера прогресса и шкал других плагинов. */
export const stageIcon = (stage: WorkStage): string => stageIconName({ kind: stageKindOf(stage), automation: stage.automation !== undefined });
