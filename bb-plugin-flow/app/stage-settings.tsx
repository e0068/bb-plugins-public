// Таблица этапов выбранного flow и ширина кнопки этапа на странице Flow.
// Этапы двух видов: агентские — их ведут Main Agent, субагенты, workflow или виджет, — и скрипты — шаги, которые
// исполняет Flow. Строка любого этапа — ручка перетаскивания поверх номера, название с иконкой
// вида в поле, исполнение — теги того, что стоит у этапа: Main Agent и
// исполнители через «или», шаги скрипта через шеврон, навык чипом «Навык: имя», — и за ними плюс с меню своего вида: у агентского этапа
// «Навык · Субагент · Workflow · Виджет», у автоматизации Automations — только навыки, у скрипта — запуск и шаги; и крест.
// Чип с файлом — навык, виджет, агент, workflow, свой скрипт — по клику открывает файл в правой панели bb.
// Под таблицей — «Добавить этап» и «Добавить скрипт» (AddStage).
// Каждая правка сохраняется: переключатели и навык — сразу, название — через 400 мс после набора, ширина — при уходе фокуса.
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { retryPolicyOf } from "../core/automation-run";
import { executorGroups, skillGroups, skillShortName, type ExecutorGroup } from "../core/catalog";
import { setFlowStages } from "../core/flows";
import { stageLabel } from "../core/stages";
import { executionOf, hasMainAgent, withExecutor, withMainAgent, withoutMainAgent } from "../core/stage-execution";
import { dropStage, ownerOf, removeStage, stageApart, stageNumbers, type DropZone } from "../core/sub-stages";
import { isTemplateSaved, removeTemplate, saveTemplate, stagesFromTemplate, templatesOfKind } from "../core/stage-templates";
import { FieldOverlay, overlayItem, useFieldOverlay } from "../components/ui/field-overlay";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { clearedSkill, isNewStageName, RETRY_LIMITS, stageSkillOf, STAGE_BUTTON_WIDTH as WIDTH, type BuiltinKind } from "../lib/stage-constants";
import { cn } from "../lib/utils";
import type { AutomationScript, flowSettingsRpcContract, SkillFile, SkillOrigin, StageCatalog, StageExecutor, WorkStage } from "../shared/contract";
import { type AutomationSets, AutomationStepTags, ManualMark, ScriptOptions, TagOpen, WidgetOptions } from "./automation-stage";
import { useMessages } from "./locale-context";
import { ExecutorMark } from "./provider-logos";
import { Segmented } from "./segmented";
import { SKILL_ICON, stageIcon } from "./stage-icons";
import { StageGlyph } from "./stage-glyph";
import { StageIconPicker } from "./stage-icon-picker";
import { updateFlowSettings, useAutomationSets, useFlowSettings, useStageTemplates } from "./stage-settings-store";

const field = "h-7 min-h-7 w-full min-w-0 rounded-md border-0 bg-card px-2 py-0 text-[13px] shadow-none focus-visible:ring-1";
const square = "flex size-7 shrink-0 items-center justify-center rounded-md";

const newStageId = (): string => `stage-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Flow, чью таблицу правит страница: строки не знают о коллекции. */
const FlowIdContext = createContext("");

/** Правка этапов открытого flow. */
function useStagesUpdate() {
  const flowId = useContext(FlowIdContext);
  return (change: (stages: WorkStage[]) => WorkStage[], save = true) => updateFlowSettings((s) => setFlowStages(s, flowId, change), save);
}

/** Наборы автоматизаций коллекции и их правка; правка без изменений ничего не пишет. */
function useSets(): AutomationSets {
  const sets = useAutomationSets();
  return {
    sets,
    update: (change) =>
      updateFlowSettings((s) => {
        const current = s.automationSets ?? [];
        const next = change(current);
        return next === current ? s : { ...s, automationSets: [...next] };
      }),
  };
}

function useSetStage() {
  const update = useStagesUpdate();
  return (id: string, change: (stage: WorkStage) => WorkStage, save = true) => update((stages) => stages.map((stage) => (stage.id === id ? change(stage) : stage)), save);
}

function ExecutorIcon({ executor }: { executor: StageExecutor }) {
  return <ExecutorMark executor={executor} className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** Имена провайдеров в заголовках групп навыков; неизвестный провайдер — его id. */
const PROVIDER_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

type Messages = ReturnType<typeof useMessages>;

const skillGroupTitle = (t: Messages, origin: SkillOrigin): string => {
  switch (origin.kind) {
    case "own":
      return t.settings.ownSkills;
    case "project":
      return t.settings.projectSkills;
    case "plugin":
      return origin.provider === undefined ? t.settings.bbPluginSkills(origin.plugin) : t.settings.providerPluginSkills(PROVIDER_NAMES[origin.provider] ?? origin.provider, origin.plugin);
  }
};

const executorGroupTitle = (t: Messages, group: ExecutorGroup): string => {
  switch (group.kind) {
    case "own":
      return t.settings.ownAgents;
    case "project":
      return t.settings.projectAgents(group.project);
    case "plugin":
      return t.settings.pluginAgents(group.plugin);
    case "codex":
      return t.settings.codexAgents;
    case "workflow":
      return t.settings.workflows;
  }
};

const groupTitle = "px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground";

/** Навыки вкладки «Навык» группами по источнику с заголовком; в строке навыка плагина провайдера — имя без префикса плагина. */
function SkillOptions({ catalog, query, current, onPick }: { catalog: StageCatalog; query: string; current: string; onPick: (name: string) => void }) {
  const t = useMessages();
  const q = query.trim().toLowerCase();
  const found = catalog.skills.filter((s) => q === "" || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q));
  return found.length === 0 ? (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">{t.settings.skillNotFound}</div>
  ) : (
    <>
      {skillGroups(found).map(({ origin, skills }) => {
        const title = skillGroupTitle(t, origin);
        return (
          <div key={title} role="group" aria-label={title}>
            <div className={groupTitle}>{title}</div>
            {skills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                role="menuitemradio"
                aria-checked={skill.name === current}
                onClick={() => onPick(skill.name)}
                className={overlayItem}
              >
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="font-mono text-xs">{skillShortName(skill)}</span>
                  {skill.description !== undefined && <span className="line-clamp-1 text-[11px] text-muted-foreground">{skill.description}</span>}
                </span>
                <MenuCheck on={skill.name === current} />
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Откуда чип берёт свой файл. */
type ChipFiles = { skill: (name: string) => void; executor: (id: string) => void; script: (script: AutomationScript) => void; missing: boolean };

/**
 * Файл чипа открывается в правой панели bb; путь находит сервер — по имени навыка, id исполнителя или тексту скрипта.
 * `missing` — файла последнего клика не нашлось: под чипами встаёт надпись, превью не открывается. Ответ на клик,
 * за которым уже был следующий, не считается; правка этапа (`stage`) убирает надпись — чипы уже другие.
 */
function useChipFiles(stage: WorkStage): ChipFiles {
  const rpc = useRpc<typeof flowSettingsRpcContract>();
  const navigate = useBbNavigate();
  const [missing, setMissing] = useState(false);
  const latest = useRef(0);
  useEffect(() => setMissing(false), [stage]);
  const open = (find: () => Promise<SkillFile>) => {
    const click = ++latest.current;
    const current = () => click === latest.current;
    setMissing(false);
    void find().then(
      (file) => {
        if (!current()) return;
        if (file === null) setMissing(true);
        else navigate.experimental_openFilePreview({ target: { kind: "host", hostId: file.hostId, path: file.path }, location: null });
      },
      () => current() && setMissing(true),
    );
  };
  return {
    skill: (name) => open(() => rpc.call("getSkillFile", { name })),
    executor: (id) => open(() => rpc.call("getExecutorFile", { id })),
    script: (script) => open(() => rpc.call("getScriptFile", script)),
    missing,
  };
}

/**
 * Навык чипом. Навыка нет среди прочитанных — файла у него нет, и чипа нет; каталог не прочитан — судить не по чему,
 * имя остаётся. У скрипта навыка нет, у встроенного этапа чипов нет вовсе — на их месте описание (`WidgetAbout`).
 */
const chipSkill = (stage: WorkStage, catalog: StageCatalog): string => {
  const named = stageSkillOf(stage);
  return named !== "" && (catalog.skills.length === 0 || catalog.skills.some((s) => s.name === named)) ? named : "";
};

/**
 * Вкладка «Навык»: поиск и навыки по группам; выбор ставит навык этапу и закрывает меню. Свой навык по имени — Enter в поиске.
 * У автоматизации Automations название — снимок того плагина, и навык его не трогает. Этап навыка без своего названия
 * берёт имя навыка.
 */
function SkillMenuOptions({ stage, catalog, onDone }: { stage: WorkStage; catalog: StageCatalog; onDone: () => void }) {
  const t = useMessages();
  const setStage = useSetStage();
  const [query, setQuery] = useState("");
  const namesStage = executionOf(stage).kind !== "external";
  const pick = (skill: string) => {
    setStage(stage.id, (s) => (namesStage ? { ...s, skill, name: s.name.trim() === "" || s.name === s.skill || isNewStageName(s.name) ? skill : s.name } : { ...s, skill }));
    onDone();
  };
  return (
    <>
      <Input
        aria-label={t.settings.findSkill}
        value={query}
        placeholder={t.settings.findSkill}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim() !== "") pick(query.trim());
        }}
        className={cn(field, "mb-1 font-mono text-xs")}
      />
      <SkillOptions catalog={catalog} query={query} current={stageSkillOf(stage)} onPick={pick} />
    </>
  );
}

type Segment = "skill" | "agent" | "workflow" | "widget";

/** Сегмент меню агентского этапа, на котором меню открывается: этап с одними workflow — на «Workflow». У виджета меню нет. */
const segmentOf = (stage: WorkStage): Segment => {
  const execution = executionOf(stage);
  return execution.kind === "executors" && execution.executors.length > 0 && execution.executors.every((e) => e.kind === "workflow") ? "workflow" : "agent";
};

/** Агенты или workflow каталога группами по источнику; галочка — стоит ли исполнитель у этапа. */
function ExecutorOptions({ stage, catalog, kind }: { stage: WorkStage; catalog: StageCatalog; kind: StageExecutor["kind"] }) {
  const t = useMessages();
  const setStage = useSetStage();
  const shown = stageLabel(stage, t.stages);
  const current = executionOf(stage);
  const found = catalog.executors.filter((e) => e.kind === kind);
  const mainAgent = kind === "agent" && current.kind === "executors" ? <MainAgentOption stage={stage} /> : null;
  if (found.length === 0)
    return (
      <>
        {mainAgent}
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{kind === "agent" ? t.settings.noAgents : t.settings.noWorkflows}</div>
      </>
    );
  return (
    <>
      {mainAgent}
      {executorGroups(found).map(({ group, executors }) => {
        const title = executorGroupTitle(t, group);
        return (
          <div key={title} role="group" aria-label={title}>
            <div className={groupTitle}>{title}</div>
            {executors.map((executor) => {
              const on = current.kind === "executors" && current.executors.some((e) => e.id === executor.id);
              return (
                <button
                  key={executor.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => setStage(stage.id, (s) => withExecutor(s, executor, shown))}
                  className={overlayItem}
                >
                  <ExecutorIcon executor={executor} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span>{executor.name}</span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">{executor.model ?? executor.description ?? ""}</span>
                  </span>
                  <MenuCheck on={on} />
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function MenuCheck({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border", on && "border-foreground bg-foreground text-background")}>
      {on && <Icon name="Check" className="size-3" />}
    </span>
  );
}

/** Main Agent пунктом меню: снимается, только когда у этапа есть другой исполнитель, — иначе вести этап некому. */
function MainAgentOption({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const setStage = useSetStage();
  const on = hasMainAgent(stage);
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      disabled={on && stage.executors.length === 0}
      onClick={() => setStage(stage.id, on ? withoutMainAgent : withMainAgent)}
      className={cn(overlayItem, "disabled:opacity-60")}
    >
      <Icon name="Bot" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span>{t.settings.mainAgent}</span>
        <span className="line-clamp-1 text-[11px] text-muted-foreground">{t.settings.mainAgentHint}</span>
      </span>
      <MenuCheck on={on} />
    </button>
  );
}

/** Меню исполнения: у скрипта — запуск и шаги, у автоматизации Automations — навыки, у агентского этапа — сегменты «Навык · Субагент · Workflow · Виджет». */
function ExecutionMenu({ stage, stages, catalog, open, onClose }: { stage: WorkStage; stages: readonly WorkStage[]; catalog: StageCatalog; open: boolean; onClose: () => void }) {
  const t = useMessages();
  const setStage = useSetStage();
  const sets = useSets();
  return (
    <FieldOverlay open={open} onClose={onClose} role="menu" label={t.settings.executionMenu} className="w-[20rem]">
      {executionOf(stage).kind === "script" ? (
        <ScriptOptions stage={stage} stages={stages} sets={sets} onChange={(change) => setStage(stage.id, change)} onDone={onClose} />
      ) : executionOf(stage).kind === "external" ? (
        // Шаги автоматизации Automations правятся в том плагине; здесь у неё правится только навык.
        <SkillMenuOptions stage={stage} catalog={catalog} onDone={onClose} />
      ) : (
        <AgentOptions stage={stage} catalog={catalog} open={open} onClose={onClose} />
      )}
    </FieldOverlay>
  );
}

/** Меню агентского этапа: наверху сегмент-контрол «Навык · Субагент · Workflow · Виджет», под ним список выбранного сегмента. */
function AgentOptions({ stage, catalog, open, onClose }: { stage: WorkStage; catalog: StageCatalog; open: boolean; onClose: () => void }) {
  const t = useMessages();
  const setStage = useSetStage();
  const [segment, setSegment] = useState<Segment>(() => segmentOf(stage));
  // Каждое открытие начинается с того, чем этап исполняется сейчас.
  useEffect(() => {
    if (open) setSegment(segmentOf(stage));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- сегмент выставляется на открытии, а не на каждой правке этапа
  }, [open]);
  return (
    <>
      <div className="sticky -top-1 z-10 -mx-1 -mt-1 mb-1 border-b border-border bg-card px-1 pb-1 pt-1">
        <Segmented<Segment>
          wide
          label={t.settings.executionKind}
          value={segment}
          onChange={setSegment}
          options={[
            { value: "skill", label: t.settings.segmentSkill },
            { value: "agent", label: t.settings.segmentAgent },
            { value: "workflow", label: t.settings.segmentWorkflow },
            { value: "widget", label: t.settings.segmentWidget },
          ]}
        />
      </div>
      {segment === "skill" ? (
        <SkillMenuOptions stage={stage} catalog={catalog} onDone={onClose} />
      ) : segment === "widget" ? (
        <WidgetOptions stage={stage} onChange={(change) => setStage(stage.id, change)} onDone={onClose} />
      ) : (
        <ExecutorOptions stage={stage} catalog={catalog} kind={segment} />
      )}
    </>
  );
}

const tag = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-card text-xs";
const tagCross = "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground";

/** Навык тегом «Навык: имя» с крестом; крест снимает навык. */
function SkillTag({ stage, skill, files }: { stage: WorkStage; skill: string; files: ChipFiles }) {
  const t = useMessages();
  const setStage = useSetStage();
  const remove = () => setStage(stage.id, (s) => ({ ...s, skill: clearedSkill(s) }));
  return (
    <span className={cn(tag, "pr-0.5")}>
      <TagOpen onOpen={() => files.skill(skill)}>
        <Icon name={SKILL_ICON} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{t.settings.skillChip(skill)}</span>
      </TagOpen>
      <button type="button" aria-label={t.settings.removeSkill(skill)} onClick={remove} className={tagCross}>
        <Icon name="X" aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

/** Исполнитель тегом с крестом; подпись открывает файл агента или workflow. */
function ExecutorTag({ stage, executor, files }: { stage: WorkStage; executor: StageExecutor; files: ChipFiles }) {
  const t = useMessages();
  const setStage = useSetStage();
  const shown = stageLabel(stage, t.stages);
  return (
    <span className={cn(tag, "pr-0.5")}>
      <TagOpen onOpen={() => files.executor(executor.id)}>
        <ExecutorIcon executor={executor} />
        <span className="min-w-0 truncate">{executor.name}</span>
        {executor.model !== undefined && <span className="shrink-0 text-[11px] text-muted-foreground">{executor.model}</span>}
      </TagOpen>
      <button type="button" aria-label={t.settings.remove(executor.name)} onClick={() => setStage(stage.id, (s) => withExecutor(s, executor, shown))} className={tagCross}>
        <Icon name="X" aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

/** Main Agent тегом; крест — только когда у этапа есть другой исполнитель. */
function MainAgentTag({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const setStage = useSetStage();
  const removable = stage.executors.length > 0;
  return (
    <span title={t.settings.mainAgentHint} className={cn(tag, removable ? "pl-2 pr-0.5" : "px-2")}>
      <Icon name="Bot" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{t.settings.mainAgent}</span>
      {removable && (
        <button type="button" aria-label={t.settings.remove(t.settings.mainAgent)} onClick={() => setStage(stage.id, withoutMainAgent)} className={tagCross}>
          <Icon name="X" aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
  );
}

/** «или» между исполнителями этапа: этап ведёт один из них — того, кого выберет владелец в брифе. */
function OrMark() {
  const t = useMessages();
  return <span className="px-0.5 text-[11px] text-muted-foreground">{t.settings.or}</span>;
}

/** Исполнители этапа тегами через «или»: Main Agent, если не снят, потом агенты и workflow. */
function ExecutorTags({ stage, executors, files }: { stage: WorkStage; executors: readonly StageExecutor[]; files: ChipFiles }) {
  const tags = [
    ...(hasMainAgent(stage) ? [<MainAgentTag key="self" stage={stage} />] : []),
    ...executors.map((executor) => <ExecutorTag key={executor.id} stage={stage} executor={executor} files={files} />),
  ];
  return tags.map((node, i) => (
    <Fragment key={node.key}>
      {i > 0 && <OrMark />}
      {node}
    </Fragment>
  ));
}

/**
 * Встроенный этап вместо тегов и плюса показывает, что он делает: исполняет его виджет Flow по своему навыку, и выбирать
 * тут нечего. Описание открывает навык этапа — свой или навык вида; этап без навыка открывать нечему.
 */
function WidgetAbout({ stage, widget, files }: { stage: WorkStage; widget: BuiltinKind; files: ChipFiles }) {
  const t = useMessages();
  const skill = stageSkillOf(stage);
  const about = t.settings.widgetAbout[widget];
  const text = "flex h-7 min-w-0 items-center text-left text-xs text-muted-foreground";
  return skill === "" ? (
    <span className={text}>{about}</span>
  ) : (
    <button type="button" title={t.settings.openFile} onClick={() => files.skill(skill)} className={cn(text, "hover:text-foreground hover:underline hover:underline-offset-2")}>
      {about}
    </button>
  );
}

/**
 * Исполнение: то, что стоит у этапа, — навык, исполнители или шаги скрипта тегами, — и за последним тегом плюс с меню;
 * у встроенного этапа — описание без плюса. Чип с файлом открывает его в правой панели; файла не нашлось — надпись под тегами.
 */
function ExecutionCell({ stage, stages, catalog }: { stage: WorkStage; stages: readonly WorkStage[]; catalog: StageCatalog }) {
  const t = useMessages();
  const setStage = useSetStage();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { root } = useFieldOverlay(open, close);
  const files = useChipFiles(stage);
  const execution = executionOf(stage);
  const skill = execution.kind === "executors" || execution.kind === "external" ? chipSkill(stage, catalog) : "";
  return (
    <span role="cell" className={cellWide}>
      <div ref={root} className="relative flex min-w-0 flex-wrap items-center gap-1">
        {skill !== "" && <SkillTag stage={stage} skill={skill} files={files} />}
        {execution.kind === "executors" && <ExecutorTags stage={stage} executors={execution.executors} files={files} />}
        {execution.kind === "widget" && <WidgetAbout stage={stage} widget={execution.widget} files={files} />}
        {execution.kind === "script" && execution.manual && <ManualMark />}
        {(execution.kind === "script" || execution.kind === "external") && <AutomationStepTags stage={stage} onChange={(change) => setStage(stage.id, change)} onOpenScript={files.script} />}
        {execution.kind !== "widget" && (
          <button type="button" aria-label={t.settings.addExecution} title={t.settings.addExecution} aria-expanded={open} onClick={() => setOpen(!open)} className={cn(square, "bg-card text-muted-foreground hover:bg-state-hover hover:text-foreground")}>
            <Icon name="Plus" aria-hidden="true" className="size-3.5" />
          </button>
        )}
        {execution.kind !== "widget" && <ExecutionMenu stage={stage} stages={stages} catalog={catalog} open={open} onClose={close} />}
        {files.missing && (
          <span role="status" className="basis-full text-[11px] text-muted-foreground">
            {t.settings.fileMissing}
          </span>
        )}
      </div>
    </span>
  );
}

/**
 * Сетка строки: номер с ручкой, средние ячейки одной группой, закладка шаблона и крест. Широкая строка — закладка
 * левее креста; узкая — закладка под крестом, а средние ячейки занимают обе строки сетки, чтобы она встала вплотную.
 * Первая колонка — 28px, ровно под номер: иконка этапа стоит в поле названия.
 */
const rowGrid = "grid grid-cols-[28px_minmax(0,1fr)_28px] items-start gap-2 @[44rem]:grid-cols-[28px_minmax(0,1fr)_28px_28px]";
/** Отступ над этапом верхнего уровня — отдельным или связкой: 3 px и 1 px зазора таблицы — 4 px; угол у края скругляется. */
const stageGap = "mt-[3px] rounded-t-lg";

/**
 * Средние ячейки — название и исполнение. Стоят в ряд, пока каждой хватает её основы, и переносятся
 * сами, когда перестаёт хватать: исполнение уходит под название. Перенос считает flex-wrap по основе ячейки,
 * а не ширина страницы, поэтому поля не встают в столбик раньше времени.
 */
const cellGroup = "flex min-w-0 flex-wrap items-start gap-2";

/**
 * Основа названия — 133px: уже поле не читается, и ряд переносится. Навык стоит чипом в исполнении, поэтому
 * его прежняя клетка отдана исполнению и названию.
 */
const cell = "min-w-0 grow basis-[133px]";

/** Исполнение тянется шире полей — там теги, а не одна строка текста. */
const cellWide = "min-w-0 grow-[4.3] basis-[334px]";

/** Ячейки строки между номером и крестом. Группа в тексте роли не имеет: ячейки остаются ячейками строки. */
function StageCells({ children }: { children: ReactNode }) {
  return (
    <span role="none" className={cn(cellGroup, "row-span-2 @[44rem]:row-span-1")}>
      {children}
    </span>
  );
}

/** Пауза набора названия перед сохранением. */
const NAME_SAVE_DELAY_MS = 400;

/** Название этапа сохраняется через паузу набора; недосохранённое уходит при размонтировании строки. */
function useStageName(stage: WorkStage) {
  const setStage = useSetStage();
  const [name, setName] = useState(stage.name);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (pending.current === null) setName(stage.name);
  }, [stage.name]);
  const flush = useRef(() => {});
  flush.current = () => {
    const next = pending.current?.trim() ?? "";
    pending.current = null;
    if (next !== "" && next !== stage.name) setStage(stage.id, (s) => ({ ...s, name: next }));
  };
  useEffect(() => {
    if (pending.current === null) return;
    const timer = setTimeout(() => flush.current(), NAME_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [name]);
  useEffect(() => () => flush.current(), []);
  const change = (text: string) => {
    pending.current = text;
    setName(text);
  };
  return { name, change, flush: () => flush.current() };
}

/** Номер этапа, у под-этапа — пусто; под наведением — ручка перетаскивания. */
function StageLead({ stage, place, dragging, onGrab }: { stage: WorkStage; place: RowPlace; dragging: boolean; onGrab: () => void }) {
  const t = useMessages();
  const name = stageLabel(stage, t.stages);
  return (
    <span role="cell" className="flex h-7 items-center text-muted-foreground">
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        <span className="text-xs tabular-nums group-hover:opacity-0">{place.number}</span>
        <button
          type="button"
          aria-label={place.owner === null ? t.settings.drag(name) : t.subStages.drag(name, place.owner)}
          onPointerDown={(e) => {
            e.preventDefault();
            onGrab();
          }}
          className={cn(square, "absolute inset-0 cursor-grab touch-none text-muted-foreground opacity-0 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100", dragging && "cursor-grabbing opacity-100")}
        >
          <Icon name="DragDropVertical" aria-hidden="true" className="size-3.5" />
        </button>
      </span>
    </span>
  );
}

/**
 * Иконка этапа у левого края поля названия — кнопка выбора иконки. Своего слоя у обёртки нет: с z-index подборка иконок
 * оставалась бы внутри него, и иконки строк ниже ложились бы поверх неё. Над полем иконка и так — она спозиционирована, а поле нет.
 */
function NameIcon({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const setStage = useSetStage();
  return (
    <span className="absolute left-0.5 top-0.5">
      <StageIconPicker icon={stage.icon} fallback={stageIcon(stage)} name={stageLabel(stage, t.stages)} onPick={(icon) => setStage(stage.id, ({ icon: _, ...s }) => (icon === undefined ? s : { ...s, icon }))} />
    </span>
  );
}

/** Подсветка места под перетаскиваемым: четверть строки у стыка или вся строка; у места в связке — плашка, чей это под-этап. */
function DropHighlight({ place }: { place: RowPlace }) {
  return (
    <>
      {place.drop === "top" && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/4 rounded-[inherit] border-t-2 border-primary bg-primary/10" />}
      {place.drop === "bottom" && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 rounded-[inherit] border-b-2 border-primary bg-primary/10" />}
      {place.drop === "whole" && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-primary/10 ring-1 ring-inset ring-primary" />}
      {place.dropLabel !== null && (
        <span className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-foreground">{place.dropLabel}</span>
      )}
    </>
  );
}

/**
 * Строка таблицы: номер с ручкой, средние ячейки строки, закладка, крест; поверх — подсветка перетаскивания. На краю этапа
 * верхнего уровня — отдельного или связки — строка отходит от соседней на 4 px и скругляет угол.
 */
function RowShell({ stage, index, stages, place, dragging, onGrab, children }: Pick<RowProps, "stage" | "index" | "stages" | "place" | "dragging" | "onGrab"> & { children: ReactNode }) {
  const t = useMessages();
  return (
    <div
      role="row"
      aria-label={t.settings.stage(index + 1)}
      data-stage-row={stage.id}
      {...(place.drop === null ? {} : { "data-drop": place.drop })}
      className={cn("group relative", rowGrid, "bg-surface-recessed-solid py-2 pl-1 pr-2", place.apart && stageGap, place.edge && "rounded-b-lg", dragging && "opacity-40")}
    >
      <StageLead stage={stage} place={place} dragging={dragging} onGrab={onGrab} />
      {children}
      {place.owner === null ? <SaveTemplate stage={stage} stages={stages} /> : <span role="cell" className={templateCell} />}
      <DeleteStage stage={stage} />
      <DropHighlight place={place} />
    </div>
  );
}

/** Клетка закладки: на узкой строке — под крестом, на широкой — левее него. */
const templateCell = "col-start-3 row-start-2 @[44rem]:col-start-auto @[44rem]:row-start-auto";

/**
 * Закладка строки этапа верхнего уровня: этап целиком, с под-этапами, — шаблоном в меню «Добавить этап»; у под-этапа
 * закладки нет. Сохранённый — закладка закрашена и недоступна.
 */
function SaveTemplate({ stage, stages }: { stage: WorkStage; stages: readonly WorkStage[] }) {
  const t = useMessages();
  const templates = useStageTemplates();
  const saved = isTemplateSaved(templates, stages, stage);
  return (
    <span role="cell" className={templateCell}>
      <button
        type="button"
        aria-label={t.settings.saveTemplate}
        aria-description={saved ? t.settings.templateSaved : undefined}
        title={saved ? t.settings.templateSaved : t.settings.saveTemplate}
        disabled={saved}
        onClick={() => updateFlowSettings((s) => ({ ...s, stageTemplates: [...saveTemplate(s.stageTemplates ?? [], stages, stage)] }))}
        className={cn(square, "text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:text-foreground disabled:hover:bg-transparent")}
      >
        <Icon name="Bookmark" aria-hidden="true" className={cn("size-3.5", saved && "fill-current")} />
      </button>
    </span>
  );
}

function DeleteStage({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const update = useStagesUpdate();
  return (
    <span role="cell" className="col-start-3 row-start-1 @[44rem]:col-start-auto @[44rem]:row-start-auto">
      <button
        type="button"
        aria-label={t.settings.deleteStage(stageLabel(stage, t.stages))}
        onClick={() => update((stages) => removeStage(stages, stage.id))}
        className={cn(square, "text-muted-foreground hover:bg-state-hover hover:text-foreground")}
      >
        <Icon name="X" aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

/** Подсветка строки под перетаскиваемым: четверть у верхнего стыка, у нижнего или вся строка. */
type DropMark = "top" | "bottom" | "whole";

/**
 * Место строки в таблице. `number` — номер этапа верхнего уровня, у под-этапа его нет, а `owner` — название владельца.
 * `apart` — строка начинает этап верхнего уровня, отдельный или связку, и отходит от строки выше; `edge` — за строкой такой отступ.
 * `drop` и `dropLabel` — подсветка перетаскивания.
 */
type RowPlace = { number: number | null; owner: string | null; apart: boolean; edge: boolean; drop: DropMark | null; dropLabel: string | null };

type RowProps = { stage: WorkStage; index: number; stages: readonly WorkStage[]; catalog: StageCatalog; place: RowPlace; dragging: boolean; onGrab: () => void };

/**
 * Строка этапа любого вида: название с иконкой, исполнение, навык; у скрипта навыка нет. У автоматизации Automations название — снимок, правится в том плагине.
 */
function StageRow({ stage, index, stages, catalog, place, dragging, onGrab }: RowProps) {
  const t = useMessages();
  const { name, change, flush } = useStageName(stage);
  const execution = executionOf(stage);
  return (
    <RowShell stage={stage} index={index} stages={stages} place={place} dragging={dragging} onGrab={onGrab}>
      <StageCells>
        {place.owner !== null ? (
          // Под-этап без названия: на широкой таблице клетка стоит пустой, чтобы колонки не съехали; на узкой её нет.
          <span role="cell" className={cn(cell, "hidden @[44rem]:block")} />
        ) : (
        <span role="cell" className={cn(cell, "relative")}>
          <NameIcon stage={stage} />
          {execution.kind === "external" || execution.kind === "widget" ? (
            // Имя автоматизации Automations — снимок того плагина, имя встроенного этапа зафиксировано: оба не правятся.
            <span title={stageLabel(stage, t.stages)} className="flex h-7 min-w-0 items-center truncate pl-8 pr-2 text-[13px]">
              {stageLabel(stage, t.stages)}
            </span>
          ) : (
            <Input aria-label={t.settings.stageName(index + 1)} placeholder={t.settings.namePlaceholder} value={name} onChange={(e) => change(e.target.value)} onBlur={flush} className={cn(field, "pl-8")} />
          )}
        </span>
        )}
        <ExecutionCell stage={stage} stages={stages} catalog={catalog} />
      </StageCells>
    </RowShell>
  );
}

/** «Добавить этап» и «Добавить скрипт» под таблицей flow `flowId`: стоят вне таблицы, поэтому flow им даёт сам. */
export function AddStage({ flowId }: { flowId: string }) {
  return (
    <FlowIdContext.Provider value={flowId}>
      <div className="flex flex-wrap items-center gap-2">
        <AddStageButton script={false} />
        <AddStageButton script />
      </div>
    </FlowIdContext.Provider>
  );
}

/** Поле названия нового этапа — в фокусе и выделено, чтобы сразу набрать своё. */
const focusName = (id: string) =>
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-stage-row="${id}"] input`);
    input?.focus();
    input?.select();
  });

/**
 * «Добавить этап» (`script` — «Добавить скрипт»): без шаблонов своего вида — сразу пустой этап в конец таблицы; с ними —
 * меню из пустого этапа и шаблонов своего вида, у каждого крест. Этап из шаблона встаёт в конец таким, каким его сохранили, — вместе с под-этапами.
 * Пустой скрипт — с пустым списком шагов: он скрипт с первой минуты, и плюс в строке открывает меню скрипта.
 */
function AddStageButton({ script }: { script: boolean }) {
  const t = useMessages();
  const update = useStagesUpdate();
  const templates = templatesOfKind(useStageTemplates(), script);
  const label = script ? t.settings.addScriptStage : t.settings.addStage;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { root } = useFieldOverlay(open, close);
  const add = (added: readonly WorkStage[]) => {
    update((stages) => [...stages, ...added]);
    close();
    const owner = added.find((stage) => stage.parent === undefined);
    if (owner !== undefined) focusName(owner.id);
  };
  // Убран последний шаблон своего вида — меню не из чего собирать: оно закрывается, и кнопка снова сразу добавляет пустой этап.
  const remove = (index: number) => {
    if (templates.length === 1) close();
    updateFlowSettings((s) => ({ ...s, stageTemplates: [...removeTemplate(s.stageTemplates ?? [], index)] }));
  };
  const empty = () => {
    const blank: WorkStage = { id: newStageId(), kind: "skill", skill: "", name: t.settings.newStage, executors: [] };
    add([script ? { ...blank, automation: { source: "flow", steps: [] } } : blank]);
  };
  return (
    <div ref={root} className="relative">
      <Button variant="secondary" size="sm" aria-expanded={templates.length > 0 ? open : undefined} onClick={() => (templates.length === 0 ? empty() : setOpen(!open))}>
        <Icon name="Plus" aria-hidden="true" />
        {label}
      </Button>
      <FieldOverlay open={open} onClose={close} role="menu" label={label} className="w-[18rem]">
        <button type="button" role="menuitem" onClick={empty} className={overlayItem}>
          <Icon name="Plus" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {script ? t.settings.emptyScript : t.settings.emptyStage}
        </button>
        <div role="group" aria-label={t.settings.templates}>
          <div className={groupTitle}>{t.settings.templates}</div>
          {templates.map(({ template, index }) => {
            const name = template.name;
            return (
              <div key={`${index}-${name}`} className="flex items-center gap-0.5">
                <button type="button" role="menuitem" title={name} onClick={() => add(stagesFromTemplate(template, newStageId, () => crypto.randomUUID()))} className={cn(overlayItem, "min-w-0 flex-1")}>
                  <StageGlyph icon={template.icon} fallback={stageIcon({ id: "", ...template })} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={t.settings.removeTemplate(name)}
                  onClick={() => remove(index)}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
                >
                  <Icon name="X" aria-hidden="true" className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      </FieldOverlay>
    </div>
  );
}

function Loading({ failed, children }: { failed: boolean; children: ReactNode }) {
  const t = useMessages();
  return failed ? <div className="text-xs text-destructive">{t.settings.loadFailed}</div> : <>{children}</>;
}

/** Строка под указателем и четверть её высоты. Выше таблицы — верх первой строки, ниже — низ последней; строк нет — `null`. */
type Hover = { target: string; zone: DropZone };

const hoverAt = (table: HTMLElement | null, y: number): Hover | null => {
  const rows = [...(table?.querySelectorAll<HTMLElement>("[data-stage-row]") ?? [])].map((el) => ({ id: el.dataset.stageRow!, box: el.getBoundingClientRect() }));
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) return null;
  if (y < first.box.top) return { target: first.id, zone: 1 };
  if (y >= last.box.bottom) return { target: last.id, zone: 4 };
  // Зазор между строками принадлежит верхней четверти следующей строки.
  const row = rows.find(({ box }) => y < box.bottom) ?? last;
  return { target: row.id, zone: Math.min(4, Math.max(1, Math.floor(((y - row.box.top) / row.box.height) * 4) + 1)) as DropZone };
};

/** Подсветка места: четверть 1 — низ строки выше и верх целевой, 2 и 3 — вся целевая, 4 — низ целевой и верх строки ниже. */
const dropMarks = (stages: readonly WorkStage[], hover: Hover): Record<string, DropMark> => {
  const at = stages.findIndex((stage) => stage.id === hover.target);
  const neighbour = (step: number): Record<string, DropMark> => {
    const id = stages[at + step]?.id;
    return id === undefined ? {} : { [id]: step < 0 ? "bottom" : "top" };
  };
  if (hover.zone === 1) return { ...neighbour(-1), [hover.target]: "top" };
  if (hover.zone === 4) return { ...neighbour(1), [hover.target]: "bottom" };
  return { [hover.target]: "whole" };
};

/**
 * Перетаскивание за ручку: строка стоит на месте, под указателем подсвечивается, куда она встанет по четверти целевой
 * строки (`dropStage`); на отпускании таблица сохраняется, если место есть.
 */
function useRowDrag(table: React.RefObject<HTMLDivElement | null>, stages: readonly WorkStage[]) {
  const update = useStagesUpdate();
  const [dragged, setDragged] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const latest = useRef(stages);
  latest.current = stages;
  useEffect(() => {
    if (dragged === null) return;
    let last: Hover | null = null;
    const onMove = (event: PointerEvent) => {
      last = hoverAt(table.current, event.clientY);
      setHover(last);
    };
    const onUp = () => {
      const next = last === null ? null : dropStage(latest.current, dragged, last.target, last.zone);
      setDragged(null);
      setHover(null);
      if (next !== null) update(() => next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- правка берёт flow из контекста, подписка — на начало перетаскивания
  }, [dragged, table]);
  const result = dragged === null || hover === null ? null : dropStage(stages, dragged, hover.target, hover.zone);
  return { dragged, grab: setDragged, hover: result === null ? null : hover, result };
}

/** Место каждой строки: номер, отступы связки, подсветка и плашка перетаскивания. */
function useRowPlaces(stages: readonly WorkStage[], dragged: string | null, hover: Hover | null, result: readonly WorkStage[] | null): RowPlace[] {
  const t = useMessages();
  const numbers = stageNumbers(stages);
  const marks = hover === null ? {} : dropMarks(stages, hover);
  const labelOf = (id: string): string => stageLabel(stages.find((stage) => stage.id === id)!, t.stages);
  const moved = result?.find((stage) => stage.id === dragged);
  const dropLabel =
    moved?.parent === undefined || result === null ? null : t.subStages.drop(labelOf(moved.parent), result.indexOf(moved) < result.findIndex((stage) => stage.id === moved.parent));
  return stages.map((stage, at) => {
    const owner = ownerOf(stages, stage.id);
    return {
      number: numbers.get(stage.id) ?? null,
      owner: owner === null ? null : labelOf(owner),
      apart: stageApart(stages, at),
      edge: stageApart(stages, at + 1),
      drop: marks[stage.id] ?? null,
      dropLabel: hover?.target === stage.id ? dropLabel : null,
    };
  });
}

/** Таблица этапов flow `flowId`. Хранилище коллекции держит страница. */
export function WorkStagesTable({ flowId }: { flowId: string }) {
  return (
    <FlowIdContext.Provider value={flowId}>
      <WorkStages flowId={flowId} />
    </FlowIdContext.Provider>
  );
}

function WorkStages({ flowId }: { flowId: string }) {
  const t = useMessages();
  const { settings, catalog, failed, saveError, saveProblem } = useFlowSettings();
  const table = useRef<HTMLDivElement>(null);
  const stages = settings?.flows.find((f) => f.id === flowId)?.stages ?? [];
  const { dragged, grab, hover, result } = useRowDrag(table, stages);
  const places = useRowPlaces(stages, dragged, hover, result);
  return (
    <Loading failed={failed}>
      {(saveProblem !== null || saveError !== null) && (
        <div role="alert" className="mb-1 text-xs text-destructive">
          {saveProblem === null ? saveError : t.settings.stepOrderRefused(t.steps[saveProblem.step], saveProblem.stageName, t.steps["git.create-pr"])}
        </div>
      )}
      <div ref={table} role="table" aria-label={t.settings.table} aria-busy={settings === null || undefined} className="@container flex flex-col gap-px overflow-visible [&>*:last-child]:rounded-b-lg [&>*:nth-child(2)]:rounded-t-lg">
        <div role="row" className={cn(rowGrid, "hidden py-1 pl-1 pr-2 text-[11px] text-muted-foreground @[46rem]:grid")}>
          <span role="columnheader" className="text-center">
            №
          </span>
          <StageCells>
            <span role="columnheader" className={cell}>
              {t.settings.colName}
            </span>
            <span role="columnheader" className={cellWide}>
              {t.settings.colExecution}
            </span>
          </StageCells>
          <span role="columnheader">
            <span className="sr-only">{t.settings.colTemplate}</span>
          </span>
          <span role="columnheader">
            <span className="sr-only">{t.settings.colDelete}</span>
          </span>
        </div>
        {stages.map((stage, index) => (
          <StageRow key={stage.id} stage={stage} index={index} stages={stages} catalog={catalog} place={places[index]!} dragging={dragged === stage.id} onGrab={() => grab(stage.id)} />
        ))}
      </div>
    </Loading>
  );
}

/** Числовая настройка строкой: набранное сохраняется по уходу фокуса, зажатое в пределы; нечисло не сохраняется. */
function NumberSetting(props: { label: string; ariaLabel: string; unit?: string; min: number; max: number; step: number; value: number | undefined; onSave: (value: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? String(props.value ?? "");
  const save = () => {
    const value = Math.round(Number(shown));
    setTyped(null);
    if (props.value === undefined || shown.trim() === "" || !Number.isFinite(value)) return;
    const clamped = Math.min(props.max, Math.max(props.min, value));
    if (clamped !== props.value) props.onSave(clamped);
  };
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-recessed-solid px-3 py-2 text-[13px]">
      <span className="flex-1">{props.label}</span>
      <Input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        aria-label={props.ariaLabel}
        disabled={props.value === undefined}
        value={shown}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={save}
        className={cn(field, "w-20 text-right font-mono text-xs")}
      />
      {props.unit !== undefined && <span className="text-muted-foreground">{props.unit}</span>}
    </label>
  );
}

/** Минимальная ширина кнопки этапа в брифе — общая на все flow. */
export function StageButtonWidth() {
  const t = useMessages();
  const { settings, failed } = useFlowSettings();
  return (
    <Loading failed={failed}>
      <NumberSetting
        label={t.settings.minWidth}
        ariaLabel={t.settings.minWidthPx}
        unit="px"
        min={WIDTH.min}
        max={WIDTH.max}
        step={10}
        value={settings?.minButtonWidth}
        onSave={(minButtonWidth) => updateFlowSettings((s) => ({ ...s, minButtonWidth }))}
      />
    </Loading>
  );
}

/** Автоповтор упавшего шага автоматизации — общий на все flow: через сколько секунд и сколько раз. */
export function AutomationRetry() {
  const t = useMessages();
  const { settings, failed } = useFlowSettings();
  const policy = settings === null ? undefined : retryPolicyOf(settings);
  return (
    <Loading failed={failed}>
      <div className="flex flex-col gap-2">
        <NumberSetting
          label={t.settings.retryIn}
          ariaLabel={t.settings.retryInSeconds}
          unit={t.settings.secondsUnit}
          min={0}
          max={RETRY_LIMITS.seconds}
          step={5}
          value={policy?.seconds}
          onSave={(retryInSeconds) => updateFlowSettings((s) => ({ ...s, retryInSeconds }))}
        />
        <NumberSetting
          label={t.settings.retryAttempts}
          ariaLabel={t.settings.retryAttempts}
          min={0}
          max={RETRY_LIMITS.attempts}
          step={1}
          value={policy?.attempts}
          onSave={(retryAttempts) => updateFlowSettings((s) => ({ ...s, retryAttempts }))}
        />
        <p className="text-xs text-muted-foreground">{t.settings.retryHint}</p>
      </div>
    </Loading>
  );
}
