// Демонстрация — одна карточка на подложке: что сделано с прошлой демонстрации,
// что нет и почему, что важно знать абзацами, секции, задачи и результаты
// строками под палец. Комментарий прикреплён к карточке снизу, кнопки исхода
// стоят отдельно в форме брифа — чтобы не нажать их случайно.
import { useRpc } from "@get-bb/plugin-sdk/app";

import { outcomeItems, paragraphs } from "../core/outcome";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { DecisionBrief, StageOutcome, outcomeRpcContract } from "../shared/contract";
import { CommandResultRow } from "./command";
import { AddRow } from "./add-row";
import type { OpenFile } from "./cells";
import { setOutcomeNote, type Draft } from "./draft";
import { useMessages } from "./locale-context";
import { SectionTag } from "./section-tag";
import { ResultRow } from "./stages-block";

export type OutcomeView = {
  draft: Draft;
  sending: boolean;
  change: (update: (draft: Draft) => Draft) => void;
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {paragraphs(text).map((part, i) => (
        <p key={i} className="m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {part}
        </p>
      ))}
    </div>
  );
}

function Items({ outcome, done }: { outcome: StageOutcome; done: boolean }) {
  const t = useMessages();
  const items = outcomeItems(outcome).filter((item) => item.done === done);
  if (items.length === 0) return null;
  return (
    <Group title={done ? t.outcome.done : t.outcome.pending}>
      {items.map((item) => (
        <div key={item.text} data-demo-item className="flex items-start gap-2 text-[13px] leading-relaxed">
          <Icon name={done ? "Check" : "X"} className={cn("mt-1 size-3.5 shrink-0", done ? "text-success" : "text-muted-foreground")} />
          <span className="break-words">
            {item.text}
            {item.why !== undefined && <span className="text-muted-foreground">{` — ${item.why}`}</span>}
          </span>
        </div>
      ))}
    </Group>
  );
}

/** Результат-команда: запуск — из сохранённого брифа по индексу результата. */
function LaunchRow({ briefId, index, label, command }: { briefId: string; index: number; label: string; command: string }) {
  const rpc = useRpc<typeof outcomeRpcContract>();
  return <CommandResultRow label={label} command={command} run={() => rpc.call("runOutcomeCommand", { briefId, index })} className={RESULT_ROW_IN_CARD} />;
}

/** Строки результатов в карточке — выше и на подложке карточки ответа. */
const RESULT_ROW_IN_CARD = "min-h-10 bg-card";

/** Карточка Демонстрации; `view` — у неотвеченной: снизу прикреплено поле комментария. */
export function DemoCard({ brief, openFile, view }: { brief: DecisionBrief; openFile: OpenFile; view?: OutcomeView }) {
  const t = useMessages();
  const outcome = brief.outcome;
  if (outcome === undefined) return null;
  const tasks = outcome.tasks ?? [];
  return (
    <div role="group" aria-label={t.outcome.title} className="flex flex-col gap-px overflow-hidden rounded-lg">
      <div className="flex flex-col gap-4 bg-surface-recessed-solid px-4 pb-4 pt-3.5">
        <SectionTag kind="demo" extra={outcome.final ? t.outcome.final : outcome.next === undefined ? undefined : t.outcome.next(outcome.next)} />
        <Items outcome={outcome} done />
        <Items outcome={outcome} done={false} />
        {outcome.notes !== undefined && (
          <Group title={t.outcome.notes}>
            <Paragraphs text={outcome.notes} />
          </Group>
        )}
        {(outcome.sections ?? []).map((section) => (
          <Group key={section.title} title={section.title}>
            <Paragraphs text={section.text} />
          </Group>
        ))}
        {tasks.length > 0 && (
          <Group title={t.outcome.tasks}>
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((task) => (
                <span key={task.key} className={cn("flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs", !task.done && "text-muted-foreground")}>
                  <Icon name={task.done ? "Check" : "X"} className="size-3" />
                  <span>{task.key}</span>
                  {task.note !== undefined && <span>{`— ${task.note}`}</span>}
                </span>
              ))}
            </div>
          </Group>
        )}
        <Group title={t.outcome.results}>
          <div className="flex flex-col gap-px overflow-hidden rounded-md">
            {outcome.results.map((result, index) =>
              "command" in result ? (
                <LaunchRow key={`${index}:${result.command}`} briefId={brief.id} index={index} label={result.label} command={result.command} />
              ) : (
                <ResultRow key={`${index}:${result.target}`} result={result} openFile={openFile} className={RESULT_ROW_IN_CARD} />
              ),
            )}
          </div>
          {outcome.documentsOnly === true && <div className="text-xs text-muted-foreground">{t.outcome.documentsOnly}</div>}
        </Group>
      </div>
      {view !== undefined && (
        <AddRow label={t.outcome.comment} placeholder={t.outcome.commentPlaceholder} value={view.draft.outcomeNote ?? ""} disabled={view.sending} voiceId="outcome" onText={(text) => view.change((d) => setOutcomeNote(d, text))} className="min-h-10" />
      )}
    </div>
  );
}
