// Утверждение и виджеты его группы, копящие ответ до него (`settle: "approval"`): Вопросы, Definition of Done, Выбор этапов и
// Демонстрация с полем комментария. Их черновики — в окне; Утверждение считает по ним правки для своей кнопки и при отправке
// уносит их ответы с собой. Кнопка говорит, что сделает: комментарий к Утверждению — «на доработку», правки без него — «с правками».
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";

import { memberOf } from "../core/outcome";
import type { approvalGroupRpcContract, DecisionBrief, GroupAnswer } from "../shared/contract";
import { memberAnswer, memberDecided, memberDraft, memberEdits } from "./approval-edits";
import { subscribeDrafts } from "./draft-storage";

/**
 * Виджеты группы Утверждения и их правки — живьём, пока владелец правит черновики; `group()` — ответы для отправки.
 * `ready` — список группы пришёл (или не пришёл совсем — тогда сторожит сервер: он отказывает Утверждению без ответов группы);
 * `undecided` — названия виджетов, где остался вопрос без ответа: без них Утверждение не утверждает.
 */
export function useApprovalGroup(approval: DecisionBrief, enabled: boolean): { ready: boolean; edits: number; undecided: string[]; group: () => GroupAnswer[] } {
  const rpc = useRpc<typeof approvalGroupRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [members, setMembers] = useState<readonly DecisionBrief[] | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const settle = (next: readonly DecisionBrief[]) => alive && setMembers(next);
    try {
      rpcRef.current.call("approvalMembers", { id: approval.id }).then(
        (answer) => settle(answer.members),
        () => settle([]),
      );
    } catch {
      settle([]);
    }
    const unsubscribe = subscribeDrafts(() => setTick((n) => n + 1));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [approval.id, enabled]);
  const list = members ?? [];
  const edits = list.reduce((sum, member) => sum + memberEdits(member, memberDraft(member)), 0);
  const undecided = list.filter((member) => memberOf(member).outcome === undefined && !memberDecided(member, memberDraft(member))).map((member) => member.title);
  return { ready: !enabled || members !== null, edits, undecided, group: () => list.map((member) => memberAnswer(member, memberDraft(member))) };
}
