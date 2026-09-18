// Обязательные документы брифов прежнего вида: правило записано в бриф при
// создании, и записанный бриф читается по нему — виджет требует галочку,
// полнота ответа её проверяет. Новые брифы правила не несут: документы
// заменили этапы работ.
import type { Artifact, DecisionBrief } from "../shared/contract";

export type Requirements = { make: readonly string[]; approve: readonly string[] };

/** «Сделать» касается того, чего нет или что не актуально; «утвердить» — того, что уже есть. */
export const requiredArtifacts = (artifacts: readonly Artifact[], required: Requirements): Artifact[] =>
  artifacts.filter(
    (a) =>
      (required.make.includes(a.id) && (a.state === "missing" || a.state === "stale")) ||
      (required.approve.includes(a.id) && (a.state === "ready" || a.state === "approved")),
  );

/** Артефакты брифа под правилом, записанным в бриф при создании; у брифа без правила обязательных нет. */
export const requiredOf = (brief: DecisionBrief): Artifact[] =>
  brief.required === undefined ? [] : requiredArtifacts(brief.setup?.artifacts ?? [], brief.required);
