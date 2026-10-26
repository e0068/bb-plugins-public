// Страница виджета на странице Flow (адрес `widget-<вид>`): из чего вид состоит — навык, настройки этапа, файлы кода по ролям —
// и под составом пример: настоящая карточка плагина с учебным содержимым. У правила настроек нет: оно не этап flow.
// Файл открывается в просмотрщике bb; путь на хосте находит сервер по пути из состава (../server/widget-files.ts),
// а нет файла — под составом строка об этом.
// Карточка примера живая, но отправка никуда не уходит: `send` отвечает «не найден», а черновик сервер для чужого id отвергает;
// пример правила решает сам у себя и ничего не записывает.
// Как у любой живой карточки, выбор владельца в примере помнится в окне до очистки хранилища — это свойство карточки, не примера.
import { useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { anatomyOf, isBuiltinWidget, WIDGET_ICONS, widgetSkillFiles, type WidgetKind } from "../core/widget-anatomy";
import { Icon } from "../components/ui/icon";
import { BUILTIN_SKILLS, builtinStage, type BuiltinKind } from "../lib/stage-constants";
import type { Messages } from "../lib/messages";
import type { DecisionBrief, RuleRecord, voiceRpcContract } from "../shared/contract";
import type { widgetFilesRpcContract } from "../server/widget-files";
import { BriefCard } from "./brief-card";
import { useMessages } from "./locale-context";
import { RuleCard } from "./rule-card";
import { VoiceProvider } from "./voice";

type Sample = Messages["flows"]["widgets"]["sample"];

const BASE = { threadId: "example", createdAt: "2026-01-01T00:00:00.000Z", kind: "brief" as const, questions: [] };
const OUTCOME_STAGES = { minButtonWidth: 170 };

/** Учебное содержимое карточки вида: то, что агент прислал бы владельцу на этом этапе. Чистая функция текстов словаря. */
export const exampleBrief = (kind: BuiltinKind, t: Messages): DecisionBrief => {
  const s: Sample = t.flows.widgets.sample;
  // Вопросы, Definition of Done, Выбор этапов и Демонстрация прогон не держат: их правки уходят с Утверждением, и пример рисует их так же.
  const brief = { ...BASE, id: `example:${kind}`, title: s.title, ...(kind === "approve" ? {} : { settle: "approval" as const }) };
  switch (kind) {
    case "questions":
      return {
        ...brief,
        questions: [
          {
            id: "files",
            kind: "fork",
            question: s.question,
            allowOwn: false,
            options: [
              { id: "list", action: s.listOption, recommended: true, description: s.listText, add: { target: 0, max: 0, risk: 0 } },
              { id: "inline", action: s.inlineOption, recommended: false, description: s.inlineText, add: { target: 2, max: 4, risk: 2, minutes: 10 } },
            ],
          },
          {
            id: "details",
            kind: "pick",
            question: s.pickQuestion,
            allowOwn: false,
            options: [
              { id: "size", action: s.pickSize, recommended: true, description: s.pickSizeText },
              { id: "date", action: s.pickDate, recommended: false, description: s.pickDateText },
            ],
          },
          { id: "reading", kind: "confirm", question: s.confirmQuestion, context: s.confirmContext, allowOwn: false, options: [{ id: "yes", action: s.confirmYes, recommended: true }] },
          {
            id: "light",
            kind: "yesno",
            question: s.yesnoQuestion,
            allowOwn: false,
            options: [
              { id: "yes", action: s.yes, recommended: true },
              { id: "no", action: s.no, recommended: false },
            ],
          },
        ],
      };
    case "criteria":
      return { ...brief, scope: s.scope, setup: { criteria: [s.criterionOne, s.criterionTwo] } };
    case "select": {
      const stage = (id: string, name: string) => ({ id, kind: "skill" as const, skill: id, name, executors: [] });
      const report = (id: string, percent: number, risk: number) => ({ id, state: "todo" as const, recommended: true, executor: "self", share: { percent, risk } });
      return {
        ...brief,
        stages: { ...OUTCOME_STAGES, list: [stage("spec", s.stageSpec), stage("practice", s.stageExecution), stage("review", s.stageReview)] },
        setup: { stages: [report("spec", 15, -1), report("practice", 100, 0), report("review", 20, -3)] },
      };
    }
    case "demo":
    case "approve":
      return {
        ...brief,
        title: kind === "demo" ? s.demoTitle : s.approveTitle,
        stages: { ...OUTCOME_STAGES, list: [{ ...builtinStage(kind, []), name: t.stages[kind] }] },
        outcome: {
          stage: kind,
          final: false,
          done: [kind === "demo" ? s.demoDone : s.approveDone],
          pending: kind === "demo" ? [{ text: s.demoPending, why: s.demoWhy }] : [],
          results: [{ label: s.demoResult, target: "https://getbb.app" }],
        },
      };
  }
};

/** Название виджета: у этапа — его название по умолчанию, у правила — своё. */
export const widgetName = (kind: WidgetKind, t: Messages): string => (isBuiltinWidget(kind) ? t.stages[kind] : t.flows.widgets.ruleName);

const EXAMPLE_SKILL = "/Users/you/.claude/skills/flow-questions/SKILL.md";

/** Учебное правило: замена строки навыка, которая с ним расходится, — дифф показывает и уходящую строку, и новую. */
export const exampleRule = (t: Messages): RuleRecord => {
  const s: Sample = t.flows.widgets.sample;
  return {
    id: "example:rule",
    threadId: "example",
    createdAt: BASE.createdAt,
    baseSha256: null,
    text: s.ruleText,
    why: s.ruleWhy,
    target: { kind: "skill", path: EXAMPLE_SKILL, name: "flow-questions" },
    mode: "replace",
    replaces: `${s.ruleOld}\n`,
    content: `${s.ruleText}.\n`,
    similar: [{ kind: "skill", path: EXAMPLE_SKILL, line: 12, quote: s.ruleOld, note: s.ruleNote }],
  };
};

/**
 * Файл состава открывается в просмотрщике bb; `missing` — файла последнего клика сервер не нашёл. Ответ на клик, за которым
 * уже был следующий, не считается.
 */
function useWidgetFiles() {
  const rpc = useRpc<typeof widgetFilesRpcContract>();
  const navigate = useBbNavigate();
  const [missing, setMissing] = useState(false);
  const latest = useRef(0);
  const open = (path: string) => {
    const click = ++latest.current;
    const current = () => click === latest.current;
    setMissing(false);
    void rpc.call("getWidgetFile", { path }).then(
      (file) => {
        if (!current()) return;
        if (file === null) setMissing(true);
        else navigate.experimental_openFilePreview({ target: { kind: "host", hostId: file.hostId, path: file.path }, location: null });
      },
      () => current() && setMissing(true),
    );
  };
  return { open, missing };
}

const SECTION = "flex flex-col gap-2";
const SECTION_TITLE = "px-0.5 text-xs font-semibold text-muted-foreground";
const ROLE_ROW = "flex items-baseline gap-2 bg-surface-recessed-solid px-2.5 py-1.5 text-xs font-semibold text-muted-foreground";
const FILE_ROW = "flex min-h-[30px] w-full items-center gap-2 bg-surface-recessed-solid px-2.5 py-1 text-left text-[13px] hover:bg-state-hover";
const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs hover:bg-state-active";

/** Путь файла: папка приглушена, имя обычное. */
function Path({ path }: { path: string }) {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span>
      <span className="font-mono text-subtle-foreground">{path.slice(0, cut)}</span>
      {path.slice(cut)}
    </span>
  );
}

function Skill({ kind, open }: { kind: WidgetKind; open: (path: string) => void }) {
  const t = useMessages();
  return (
    <div className={SECTION}>
      <h3 className={SECTION_TITLE}>{t.flows.widgets.skill}</h3>
      <div className="flex flex-wrap gap-1.5">
        {widgetSkillFiles(kind).map((path) => (
          <button key={path} type="button" onClick={() => open(path)} className={CHIP}>
            <Icon name="BookOpen" aria-hidden="true" className="size-3.5 shrink-0" />
            {path.split("/").slice(-2).join("/")}
          </button>
        ))}
      </div>
    </div>
  );
}

function Settings({ kind }: { kind: BuiltinKind }) {
  const t = useMessages();
  const w = t.flows.widgets;
  return (
    <div className={SECTION}>
      <h3 className={SECTION_TITLE}>{w.settings}</h3>
      <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-surface-recessed-solid px-2.5 py-1.5 text-[13px]">
        <dt className="text-muted-foreground">{w.kind}</dt>
        <dd className="font-mono">{kind}</dd>
        <dt className="text-muted-foreground">{w.defaultName}</dt>
        <dd>{t.stages[kind]}</dd>
        <dt className="text-muted-foreground">{w.defaultSkill}</dt>
        <dd className="font-mono">{BUILTIN_SKILLS[kind]}</dd>
      </dl>
    </div>
  );
}

function Code({ kind, files }: { kind: WidgetKind; files: ReturnType<typeof useWidgetFiles> }) {
  const t = useMessages();
  return (
    <div className={SECTION}>
      <h3 className={SECTION_TITLE}>{t.flows.widgets.code}</h3>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg">
        {anatomyOf(kind).map(({ role, files: paths }) => (
          <div key={role} className="contents">
            <div className={ROLE_ROW}>{t.flows.widgets.roles[role]}</div>
            {paths.map((path) => (
              <button key={path} type="button" onClick={() => files.open(path)} className={FILE_ROW}>
                <Icon name="File" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <Path path={path} />
              </button>
            ))}
          </div>
        ))}
      </div>
      {files.missing && <p className="px-0.5 text-xs text-subtle-foreground">{t.flows.widgets.missing}</p>}
    </div>
  );
}

/** Пример: настоящая карточка, отправка которой никуда не уходит. */
function Example({ kind }: { kind: WidgetKind }) {
  const t = useMessages();
  const voice = useRpc<typeof voiceRpcContract>();
  return (
    <div className={SECTION}>
      <h3 className={SECTION_TITLE}>{t.flows.widgets.example}</h3>
      {isBuiltinWidget(kind) ? (
        <VoiceProvider transcribe={(input) => voice.call("transcribeVoice", input)}>
          <BriefCard brief={exampleBrief(kind, t)} send={async () => ({ kind: "not_found" })} onResult={() => undefined} roots={null} />
        </VoiceProvider>
      ) : (
        <RuleExample rule={exampleRule(t)} />
      )}
    </div>
  );
}

/** Пример правила решает сам у себя: «Записать» и «Не записывать» показывают строку исхода, файлы не трогаются. */
function RuleExample({ rule }: { rule: RuleRecord }) {
  return (
    <RuleCard
      key={rule.text}
      initial={rule}
      decide={async ({ decision, text }) => ({
        kind: "found",
        rule: { ...rule, decision: decision === "write" ? { kind: "written", at: rule.createdAt, text: text ?? rule.text, paths: [rule.target.path] } : { kind: "declined", at: rule.createdAt } },
      })}
    />
  );
}

export function WidgetPage({ kind }: { kind: WidgetKind }) {
  const t = useMessages();
  const files = useWidgetFiles();
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex h-9 items-center">
          <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
            <Icon name={WIDGET_ICONS[kind]} aria-hidden="true" className="size-7" />
          </span>
          <h2 className="truncate pl-1.5 text-lg font-semibold">{widgetName(kind, t)}</h2>
        </div>
        <p className="px-2.5 pt-1 text-[13px] text-muted-foreground">{t.flows.widgets.purpose[kind]}</p>
      </div>
      <Skill kind={kind} open={files.open} />
      {isBuiltinWidget(kind) && <Settings kind={kind} />}
      <Code kind={kind} files={files} />
      <Example kind={kind} />
    </section>
  );
}
