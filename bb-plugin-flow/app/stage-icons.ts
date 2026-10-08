// Значок этапа на странице Flow; сами имена значков по виду живут в lib/stage-icon-names — их берёт и сервер.
import { stageKindOf } from "../lib/stage-constants";
import { AUTOMATION_ICON, KIND_ICONS, SKILL_ICON } from "../lib/stage-icon-names";
import type { WorkStage } from "../shared/contract";

export { AUTOMATION_ICON, KIND_ICONS, SKILL_ICON } from "../lib/stage-icon-names";

/** Значок этапа по его виду: автоматизация, Action — запуск, встроенный вид — свой знак, навык — книга. */
export const stageIcon = (stage: WorkStage): string => {
  const kind = stageKindOf(stage);
  if (kind === "action") return KIND_ICONS.action;
  if (stage.automation !== undefined) return AUTOMATION_ICON;
  return kind === "skill" ? SKILL_ICON : KIND_ICONS[kind];
};
