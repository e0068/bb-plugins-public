// Рисунок значка этапа без React: сервер отдаёт его другим плагинам, которые каталога значков Flow не знают.
import {
  ArrangeIcon,
  BookOpen01Icon,
  BotIcon,
  CheckListIcon,
  DiamondIcon,
  MessageQuestionIcon,
  PlayIcon,
  PresentationBarChart01Icon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { STAGE_ICONS } from "./stage-icon-catalog";

/** Workflow пунктиром — значок этапа Выбор этапов: тот же рисунок, линия штрихом. */
export const WorkflowDashedIcon: IconSvgElement = WorkflowCircle03Icon.map(([tag, attrs]) => [tag, { ...attrs, strokeDasharray: "2.5 2.5" }]) as IconSvgElement;

/** Рисунки запасных значков этапа — по именам из lib/stage-icon-names — и значков исполнителя в итоге прогона; Icon берёт их из этой же карты. */
export const KIND_GLYPHS = {
  MessageQuestion: MessageQuestionIcon,
  ListTodo: CheckListIcon,
  WorkflowDashed: WorkflowDashedIcon,
  Presentation: PresentationBarChart01Icon,
  Play: PlayIcon,
  Arrange: ArrangeIcon,
  BookOpen: BookOpen01Icon,
  Diamond: DiamondIcon,
  Bot: BotIcon,
  Workflow: WorkflowCircle03Icon,
} as const satisfies Record<string, IconSvgElement>;

/** Рисунок запасного значка по имени; неизвестное имя — `undefined`. */
export const kindGlyph = (name: string): IconSvgElement | undefined => (KIND_GLYPHS as Readonly<Record<string, IconSvgElement>>)[name];

/** Рисунок значка этапа: свой из каталога, а без него или с пропавшим — запасной; неизвестное запасное — значок автоматизации. */
export const stageGlyph = ({ icon, fallbackIcon }: { icon: string | undefined; fallbackIcon: string }): IconSvgElement =>
  (icon === undefined ? undefined : STAGE_ICONS.get(icon)) ?? kindGlyph(fallbackIcon) ?? KIND_GLYPHS.Arrange;
