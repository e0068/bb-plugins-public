// Предложение flow на Утверждении: агент в указаниях хода узнаёт, когда класть outcome.nextFlow и какие flow есть у владельца.
// Без этого он правит код во flow без мёржа и спрашивает владельца, как довезти работу до main (BBPL-1005).
import { stageKindOf } from "../lib/stage-constants";
import type { WorkStage } from "../shared/contract";

export type FlowRef = { id: string; name: string };

/** Есть ли в этапах Утверждение: nextFlow ложится только на него, без него предлагать flow негде. */
export const hasApprovalStage = (stages: readonly WorkStage[]): boolean => stages.some((stage) => stageKindOf(stage) === "approve");

const OFFER_RULE =
  "Approval can move the work into another flow: when what you did would not reach main with the stages left in this flow (code changed, but no commit, PR or merge ahead), put outcome.nextFlow — the id of the owner's flow that carries it to main — on that approval; one send moves the thread there. Do not ask the owner how to publish.";

/** Flow владельца, кроме текущего flow треда, — куда Утверждение может перевести работу. */
export const otherFlowsOf = (flows: readonly FlowRef[], currentId: string | undefined): FlowRef[] =>
  flows.filter((flow) => flow.id !== currentId).map(({ id, name }) => ({ id, name }));

/** Строка flow в списке: id, по которому его называют в nextFlow, и название. */
const flowRow = (flow: FlowRef): string => `${flow.id} "${flow.name}"`;

/**
 * Правило предложения flow со списком flow владельца: `shown` идут в текст, `more` — часть списка не влезла, остальное
 * агент читает инструментом read_flows. Без flow, на которые можно перейти, предлагать нечего — `null`.
 */
export const nextFlowOffer = (shown: readonly FlowRef[], more: boolean): string | null => {
  if (shown.length === 0 && !more) return null;
  const rows = [...shown.map(flowRow), ...(more ? ["… the rest — read_flows"] : [])];
  return `${OFFER_RULE} The owner's other flows: ${rows.join(", ")}.`;
};
