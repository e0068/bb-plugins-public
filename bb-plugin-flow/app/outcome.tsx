// Демонстрация — одна карточка на подложке: что сделано с прошлой демонстрации,
// что нет и почему, что важно знать абзацами, секции, задачи и результаты
// строками под палец. Это отчёт: ни поля комментария, ни кнопок под ним нет — владелец
// комментирует на утверждении. У Утверждения карточки нет — только поле комментария. Задача — копия
// карточки Tasks+ (./task-card.tsx): директиву `::task` Markdown для плагинов не
// рисует, а карточка открывает задачу сбоку во вкладке Flow.
import { useRpc } from "@get-bb/plugin-sdk/app";

import { isTaskAddress } from "../core/task-lookup";
import { outcomeItems, outcomeKind } from "../core/outcome";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { DecisionBrief, StageOutcome, outcomeRpcContract } from "../shared/contract";
import { CommandResultRow } from "./command";
import { AddRow } from "./add-row";
import { RichText } from "./linked-text";
import type { FileRoots } from "../core/result-link";
import { setOutcomeNote, type Draft } from "./draft";
import { useMessages } from "./locale-context";
import { SectionTag } from "./section-tag";
import { ResultRow } from "./result-row";
import { TaskCard } from "./task-card";
import { PrototypeWidget } from "./prototype-widget";

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
    <div className="break-words text-sm leading-relaxed">
      <RichText text={text} />
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
        <div key={item.text} data-demo-item className="flex items-start gap-2 text-sm leading-relaxed">
          <Icon name={done ? "Check" : "X"} className={cn("mt-1 size-3.5 shrink-0", done ? "text-success" : "text-muted-foreground")} />
          <span className="break-words">
            <RichText text={item.text} />
            {item.why !== undefined && (
              <span className="text-muted-foreground">
                {" — "}
                <RichText text={item.why} />
              </span>
            )}
          </span>
        </div>
      ))}
    </Group>
  );
}

/**
 * Задачи группой: «Review» — чей итог показан (`done`), они станут done, когда владелец примет шаг; «Created» — только
 * заведённые. Статус видно в самой карточке, подписей нет. Задача ищется в рабочем дереве треда брифа; ключ, который
 * задачу не адресует, — текстом.
 */
function Tasks({ outcome, done, threadId }: { outcome: StageOutcome; done: boolean; threadId: string }) {
  const t = useMessages();
  const tasks = (outcome.tasks ?? []).filter((task) => task.done === done);
  if (tasks.length === 0) return null;
  return (
    <Group title={done ? t.outcome.tasksReview : t.outcome.tasksCreated}>
      {tasks.map((task) => (
        <div key={task.key} data-demo-task className={isTaskAddress(task.key) ? undefined : "font-mono text-xs"}>
          {isTaskAddress(task.key) ? <TaskCard taskKey={task.key} threadId={threadId} /> : task.key}
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

/**
 * Карточка Демонстрации — отчёт. У Утверждения карточки нет: что утверждается, агент называет заголовком, а поле комментария рисует форма (`CommentRow`).
 * Прототип итога встаёт виджетом после карточки, а не в ней: карточка обрезает края, а окно прототипа шире колонки.
 */
export function DemoCard({ brief, roots }: { brief: DecisionBrief; roots: FileRoots | null }) {
  const t = useMessages();
  const outcome = brief.outcome;
  if (outcome === undefined) return null;
  const kind = outcomeKind(brief);
  if (kind === "approve") return null;
  return (
    <>
    <div role="group" aria-label={t.outcome.title} className="flex flex-col overflow-hidden rounded-lg">
      <div className="flex flex-col gap-4 bg-surface-recessed-solid px-4 pb-4 pt-3.5">
        <SectionTag kind={kind} extra={outcome.final ? t.outcome.final : outcome.next === undefined ? undefined : t.outcome.next(outcome.next)} />
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
        <Tasks outcome={outcome} done threadId={brief.threadId} />
        <Tasks outcome={outcome} done={false} threadId={brief.threadId} />
        <Group title={t.outcome.results}>
          <div className="flex flex-col gap-px overflow-hidden rounded-md">
            {outcome.results.map((result, index) =>
              "command" in result ? (
                <LaunchRow key={`${index}:${result.command}`} briefId={brief.id} index={index} label={result.label} command={result.command} />
              ) : (
                <ResultRow key={`${index}:${result.target}`} result={result} roots={roots} className={RESULT_ROW_IN_CARD} />
              ),
            )}
          </div>
          {outcome.documentsOnly === true && <div className="text-xs text-muted-foreground">{t.outcome.documentsOnly}</div>}
        </Group>
      </div>
    </div>
    {outcome.prototype !== undefined && <PrototypeWidget threadId={brief.threadId} url={outcome.prototype.url} {...(outcome.prototype.title === undefined ? {} : { title: outcome.prototype.title })} />}
    </>
  );
}

/** Поле комментария к итогу: единственное, что видно у неотвеченного Утверждения. */
export function CommentRow({ view }: { view: OutcomeView }) {
  const t = useMessages();
  return <AddRow label={t.outcome.comment} placeholder={t.outcome.commentPlaceholder} value={view.draft.outcomeNote ?? ""} disabled={view.sending} voiceId="outcome" onText={(text) => view.change((d) => setOutcomeNote(d, text))} className="min-h-10" />;
}
