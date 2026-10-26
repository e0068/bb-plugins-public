// Слой 1 — чисто. Строка агенту, когда владелец применил flow кнопкой «Применить» посреди его хода: этапы нового flow
// иначе пришли бы только с инструкциями следующего хода, а агент до тех пор шёл бы по прежним.
import { compactStageInstructions } from "./stages";
import type { WorkStage } from "../shared/contract";

export const appliedFlowLine = (name: string, stages: readonly WorkStage[]): string =>
  [
    `The owner applied the flow "${name}" to this thread in the middle of your turn: go on by its stages from where the work stands, the stages of the previous flow no longer apply. Mark them with flow_stage; the next turn's instructions carry the same list.`,
    compactStageInstructions(stages) ?? "The flow has no stages.",
  ].join("\n");

export const noFlowLine =
  "The owner switched this thread to no flow in the middle of your turn: go on without stages — no briefs, no flow_stage marks — and finish the work in plain replies.";
