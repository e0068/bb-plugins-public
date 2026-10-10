// Таблица этапов выбранного flow и ширина кнопки этапа на странице Flow.
// Этапы двух видов: агентские — их ведут Main Agent, субагенты, workflow или виджет, — и скрипты — шаги, которые
// исполняет Flow. Строка любого этапа — ручка перетаскивания поверх номера, название с иконкой
// вида в поле, исполнение — теги того, что стоит у этапа: Main Agent и
// исполнители через «или», шаги скрипта через шеврон, навык чипом «Навык: имя», — и за ними плюс с меню своего вида: у агентского этапа
// «Навык · Субагент · Workflow · Виджет», у автоматизации Automations — только навыки, у скрипта — запуск и шаги; и крест.
// Чип с файлом — навык, виджет, агент, workflow, свой скрипт — по клику открывает файл в правой панели bb.
// Этап «Flow» — связка строк по этапам вложенного flow, только для чтения: имя flow текстом, чипы без крестиков и плюсов.
// Под таблицей — «Добавить этап» (пустой этап, виджеты, другие flow, шаблоны) и «Добавить скрипт» (AddStage).
// Каждая правка сохраняется: переключатели и навык — сразу, название — через 400 мс после набора, ширина — при уходе фокуса.
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { DEFAULT_FAILURE_INSTRUCTION, retryPolicyOf, wakesAgentAfterLastRetry, withFailureInstruction } from "../core/automation-run";
import { clearsContextAfterAutoChoice } from "../core/skill-scope";
import { executorGroups, skillGroups, skillShortName, type ExecutorGroup } from "../core/catalog";
import { expandStages, flowStage, nestableFlows, setFlowStages, stageToFlow, stageToFlowProblem } from "../core/flows";
import { freeFlowName } from "../core/flow-files";
import { stageLabel } from "../core/stages";
import { executionOf, hasMainAgent, withExecutor, withMainAgent, withoutMainAgent, withWidget } from "../core/stage-execution";
import { hoverAt, type Hover, type RowBox } from "../core/row-hover";
import { dropStage, ownerOf, removeStage, stageApart, stageNumbers } from "../core/sub-stages";
import { isTemplateSaved, removeTemplate, saveTemplate, stagesFromTemplate, templatesOfKind } from "../core/stage-templates";
import { FieldOverlay, overlayItem, useFieldOverlay } from "../components/ui/field-overlay";
import { Button } from "../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Icon, type IconName } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { BUILTIN_KINDS, clearedSkill, isNewStageName, MAX_WAKE_INSTRUCTION_CHARS, RETRY_LIMITS, stageSkillOf } from "../lib/stage-constants";
import { cn } from "../lib/utils";
import type { AutomationScript, Flow, flowSettingsRpcContract, SkillFile, SkillOrigin, StageCatalog, StageExecutor, WorkStage } from "../shared/contract";
import { type AutomationSets, AutomationStepTags, ManualMark, ReadOnlyStepTags, ScriptOptions, type StageChange, TagOpen, WidgetOptions } from "./automation-stage";
import { useMessages } from "./locale-context";
import { useMentions } from "./mentions";
import { FlowGlyph } from "./flow-glyph";
import { newFlowId } from "./flows-list";
import { ExecutorMark } from "./provider-logos";
import { Segmented } from "./segmented";
import { KIND_ICONS, SKILL_ICON, stageIcon } from "./stage-icons";
import { StageGlyph } from "./stage-glyph";
import { StageIconPicker } from "./stage-icon-picker";
import { updateFlowSettings, useAutomationSets, useFlowSettings, useStageTemplates } from "./stage-settings-store";

const field = "h-7 min-h-7 max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-sm w-full min-w-0 rounded-md border-0 bg-card px-2 py-0 text-[13px] shadow-none focus-visible:ring-1";
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

/** Линия между группами меню «Добавить этап» — та же, что в меню этапа-автоматизации. */
const menuSeparator = <div role="separator" className="my-1 h-px bg-border" />;
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
 * имя остаётся. У скрипта навыка нет; у встроенного этапа — навык вида или свой, чипом без креста.
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
  // Открыт ли PR раньше этапа, читается по этапам прогона: PR мог открыть вложенный flow.
  const own = useContext(FlowIdContext);
  const { settings } = useFlowSettings();
  const flow = settings?.flows.find((f) => f.id === own);
  const read = flow === undefined || settings === null ? stages : expandStages(settings.flows, flow);
  return (
    <FieldOverlay open={open} onClose={onClose} role="menu" label={t.settings.executionMenu} className="w-[20rem]">
      {executionOf(stage).kind === "script" ? (
        <ScriptOptions stage={stage} stages={read} sets={sets} onChange={(change) => setStage(stage.id, change)} onDone={onClose} />
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

/** Правка этапа строки; `null` — строка только для чтения: этап вложенного flow правится на его собственной странице. */
type ChipChange = StageChange | null;

/** Крест чипа подписью `label`; без действия креста нет. */
function TagCross({ label, onRemove }: { label: string; onRemove: (() => void) | null }) {
  return onRemove === null ? null : (
    <button type="button" aria-label={label} onClick={onRemove} className={tagCross}>
      <Icon name="X" aria-hidden="true" className="size-3" />
    </button>
  );
}

/** Навык тегом «Навык: имя»; крест снимает навык, у строки только для чтения креста нет. */
function SkillTag({ skill, files, change }: { skill: string; files: ChipFiles; change: ChipChange }) {
  const t = useMessages();
  return (
    <span className={cn(tag, change === null ? "pr-2" : "pr-0.5")}>
      <TagOpen onOpen={() => files.skill(skill)}>
        <Icon name={SKILL_ICON} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{t.settings.skillChip(skill)}</span>
      </TagOpen>
      <TagCross label={t.settings.removeSkill(skill)} onRemove={change && (() => change((s) => ({ ...s, skill: clearedSkill(s) })))} />
    </span>
  );
}

/** Исполнитель тегом; подпись открывает файл агента или workflow, крест снимает исполнителя. */
function ExecutorTag({ stage, executor, files, change }: { stage: WorkStage; executor: StageExecutor; files: ChipFiles; change: ChipChange }) {
  const t = useMessages();
  const shown = stageLabel(stage, t.stages);
  return (
    <span className={cn(tag, change === null ? "pr-2" : "pr-0.5")}>
      <TagOpen onOpen={() => files.executor(executor.id)}>
        <ExecutorIcon executor={executor} />
        <span className="min-w-0 truncate">{executor.name}</span>
        {executor.model !== undefined && <span className="shrink-0 text-[11px] text-muted-foreground">{executor.model}</span>}
      </TagOpen>
      <TagCross label={t.settings.remove(executor.name)} onRemove={change && (() => change((s) => withExecutor(s, executor, shown)))} />
    </span>
  );
}

/** Main Agent тегом; крест — только когда у этапа есть другой исполнитель и строка правится. */
function MainAgentTag({ stage, change }: { stage: WorkStage; change: ChipChange }) {
  const t = useMessages();
  const removable = change !== null && stage.executors.length > 0;
  return (
    <span title={t.settings.mainAgentHint} className={cn(tag, removable ? "pl-2 pr-0.5" : "px-2")}>
      <Icon name="Bot" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{t.settings.mainAgent}</span>
      <TagCross label={t.settings.remove(t.settings.mainAgent)} onRemove={removable ? () => change(withoutMainAgent) : null} />
    </span>
  );
}

/** «или» между исполнителями этапа: этап ведёт один из них — того, кого выберет владелец в брифе. */
function OrMark() {
  const t = useMessages();
  return <span className="px-0.5 text-[11px] text-muted-foreground">{t.settings.or}</span>;
}

/** Исполнители этапа тегами через «или»: Main Agent, если не снят, потом агенты и workflow. */
function ExecutorTags({ stage, executors, files, change }: { stage: WorkStage; executors: readonly StageExecutor[]; files: ChipFiles; change: ChipChange }) {
  const tags = [
    ...(hasMainAgent(stage) ? [<MainAgentTag key="self" stage={stage} change={change} />] : []),
    ...executors.map((executor) => <ExecutorTag key={executor.id} stage={stage} executor={executor} files={files} change={change} />),
  ];
  return tags.map((node, i) => (
    <Fragment key={node.key}>
      {i > 0 && <OrMark />}
      {node}
    </Fragment>
  ));
}

/**
 * Чипы исполнения этапа: навык, исполнители через «или», ручной запуск и шаги скрипта. С правкой этапа (`change`) у чипов
 * кресты, а шаги скрипта перетаскиваются; без неё — только чтение: так стоят этапы вложенного flow. Навык встроенного этапа
 * не снимается и тут: этап исполняет виджет Flow по этому навыку.
 * Чип с файлом открывает его в правой панели в обоих случаях.
 */
function ExecutionChips({ stage, catalog, files, change }: { stage: WorkStage; catalog: StageCatalog; files: ChipFiles; change: ChipChange }) {
  const execution = executionOf(stage);
  const skill = execution.kind === "script" ? "" : chipSkill(stage, catalog);
  return (
    <>
      {skill !== "" && <SkillTag skill={skill} files={files} change={execution.kind === "widget" ? null : change} />}
      {execution.kind === "executors" && <ExecutorTags stage={stage} executors={execution.executors} files={files} change={change} />}
      {execution.kind === "script" && execution.manual && <ManualMark />}
      {(execution.kind === "script" || execution.kind === "external") &&
        (change === null ? <ReadOnlyStepTags stage={stage} onOpenScript={files.script} /> : <AutomationStepTags stage={stage} onChange={change} onOpenScript={files.script} />)}
    </>
  );
}

/** Надпись под чипами: файла последнего кликнутого чипа не нашлось. */
function MissingFile({ files }: { files: ChipFiles }) {
  const t = useMessages();
  return files.missing ? (
    <span role="status" className="basis-full text-[11px] text-muted-foreground">
      {t.settings.fileMissing}
    </span>
  ) : null;
}

/** Ячейка исполнения: чипы в ряд с переносом. */
const chipRow = "flex min-w-0 flex-wrap items-center gap-1";

/**
 * Исполнение: чипы этапа (`ExecutionChips`) и за последним плюс с меню; у встроенного этапа — тег навыка без плюса.
 */
function ExecutionCell({ stage, stages, catalog }: { stage: WorkStage; stages: readonly WorkStage[]; catalog: StageCatalog }) {
  const t = useMessages();
  const setStage = useSetStage();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { root } = useFieldOverlay(open, close);
  const files = useChipFiles(stage);
  const widget = executionOf(stage).kind === "widget";
  return (
    <span role="cell" className={cellWide}>
      <div ref={root} className={cn(chipRow, "relative")}>
        <ExecutionChips stage={stage} catalog={catalog} files={files} change={(next) => setStage(stage.id, next)} />
        {!widget && (
          <button type="button" aria-label={t.settings.addExecution} title={t.settings.addExecution} aria-expanded={open} onClick={() => setOpen(!open)} className={cn(square, "bg-card text-muted-foreground hover:bg-state-hover hover:text-foreground")}>
            <Icon name="Plus" aria-hidden="true" className="size-3.5" />
          </button>
        )}
        {!widget && <ExecutionMenu stage={stage} stages={stages} catalog={catalog} open={open} onClose={close} />}
        <MissingFile files={files} />
      </div>
    </span>
  );
}

/** Исполнение этапа вложенного flow только для чтения: те же чипы, что у своего этапа, без крестиков и без плюса — он правится на странице своего flow. */
function ReadOnlyExecution({ stage, catalog }: { stage: WorkStage; catalog: StageCatalog }) {
  const files = useChipFiles(stage);
  return (
    <span role="cell" className={cellWide}>
      <div className={chipRow}>
        <ExecutionChips stage={stage} catalog={catalog} files={files} change={null} />
        <MissingFile files={files} />
      </div>
    </span>
  );
}

/** Вложенный flow удалён: вместо его этапов — надпись. */
function NestedFlowGone() {
  const t = useMessages();
  return (
    <span role="cell" className={cellWide}>
      <span className={cn(tag, "px-2 text-muted-foreground")}>{t.settings.nestedFlowGone}</span>
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

/** Название текстом, без правки — у встроенного этапа, автоматизации Automations, этапа-flow и этапов вложенного flow. */
function FixedName({ text }: { text: string }) {
  return (
    <span title={text} className="flex h-7 min-w-0 items-center truncate pl-8 pr-2 text-[13px]">
      {text}
    </span>
  );
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
    <span className="absolute inset-y-0 left-0.5 flex items-center">
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
 * Строка таблицы: номер с ручкой, средние ячейки строки, «⋯», крест; поверх — подсветка перетаскивания. На краю этапа
 * верхнего уровня — отдельного или связки — строка отходит от соседней на 4 px и скругляет угол.
 */
function RowShell({ stage, index, stages, place, dragging, onGrab, children }: Pick<RowProps, "stage" | "index" | "stages" | "place" | "dragging" | "onGrab"> & { children: ReactNode }) {
  const t = useMessages();
  return (
    <RowFrame label={t.settings.stage(index + 1)} stageId={stage.id} place={place} dragging={dragging}>
      <StageLead stage={stage} place={place} dragging={dragging} onGrab={onGrab} />
      {children}
      {place.owner === null && stage.flowId === undefined ? <StageMenu stage={stage} stages={stages} /> : <span role="cell" className={templateCell} />}
      <DeleteStage stage={stage} />
    </RowFrame>
  );
}

/**
 * Рамка строки таблицы: сетка, фон, отступ и скругление на краю этапа верхнего уровня, тусклость под перетаскиванием и
 * подсветка места. `stageId` — этап, за которым строка числится при перетаскивании.
 */
function RowFrame({ label, stageId, place, dragging, children }: { label: string; stageId: string; place: RowPlace; dragging: boolean; children: ReactNode }) {
  return (
    <div
      role="row"
      aria-label={label}
      data-stage-row={stageId}
      {...(place.drop === null ? {} : { "data-drop": place.drop })}
      className={cn("group relative", rowGrid, "bg-surface-recessed-solid py-2 pl-1 pr-2", place.apart && stageGap, place.edge && "rounded-b-lg", dragging && "opacity-40")}
    >
      {children}
      <DropHighlight place={place} />
    </div>
  );
}

/** Клетка меню «⋯»: на узкой строке — под крестом, на широкой — левее него. */
const templateCell = "col-start-3 row-start-2 @[44rem]:col-start-auto @[44rem]:row-start-auto";

/**
 * «⋯» строки этапа верхнего уровня; у под-этапа и строки «Flow» меню нет. «Сохранить этап шаблоном» кладёт этап целиком, с
 * под-этапами, шаблоном в меню «Добавить этап». «Преобразовать во Flow» уносит связку в новый flow с именем этапа, а на её место
 * ставит строку «Flow» нового flow; страница остаётся на текущем flow. Недоступный пункт — у сохранённого этапа и у этапа, чей
 * вынос сломал бы порядок шагов PR, — несёт причину строкой под собой: подсказку при наведении меню на нём не показывает.
 */
function StageMenu({ stage, stages }: { stage: WorkStage; stages: readonly WorkStage[] }) {
  const t = useMessages();
  const flowId = useContext(FlowIdContext);
  const { settings } = useFlowSettings();
  const saved = isTemplateSaved(useStageTemplates(), stages, stage);
  const blocked = settings !== null && stageToFlowProblem(settings, flowId, stage.id) !== null;
  const name = stageLabel(stage, t.stages);
  const save = () => updateFlowSettings((s) => ({ ...s, stageTemplates: [...saveTemplate(s.stageTemplates ?? [], stages, stage)] }));
  const toFlow = () => updateFlowSettings((s) => stageToFlow(s, flowId, stage.id, { id: newFlowId(), name: freeFlowName(s.flows, name) }));
  return (
    <span role="cell" className={templateCell}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t.settings.stageMenu(name)} className={cn(square, "text-muted-foreground hover:bg-state-hover hover:text-foreground")}>
            <Icon name="MoreHorizontal" aria-hidden="true" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8}>
          <StageMenuItem label={t.settings.saveTemplate} reason={saved ? t.settings.templateSaved : null} onSelect={save} icon={<Icon name="Bookmark" aria-hidden="true" className={cn("size-3.5", saved && "fill-current")} />} />
          <StageMenuItem label={t.settings.toFlow} reason={blocked ? t.settings.toFlowBlocked : null} onSelect={toFlow} icon={<FlowGlyph className="size-3.5" />} />
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** Пункт меню строки этапа; с причиной `reason` он недоступен, и причина стоит мелкой строкой под названием. */
function StageMenuItem({ label, reason, icon, onSelect }: { label: string; reason: string | null; icon: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenuItem disabled={reason !== null} aria-description={reason ?? undefined} onSelect={onSelect}>
      {icon}
      <span className="flex min-w-0 flex-col leading-tight">
        <span>{label}</span>
        {reason !== null && (
          <span aria-hidden="true" className="max-w-[16rem] text-[11px] text-muted-foreground">
            {reason}
          </span>
        )}
      </span>
    </DropdownMenuItem>
  );
}

function DeleteStage({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const update = useStagesUpdate();
  return (
    <span role="cell" className={deleteCell}>
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
            <FixedName text={stageLabel(stage, t.stages)} />
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

/** Клетка креста: на узкой строке — над закладкой, на широкой — последней. */
const deleteCell = "col-start-3 row-start-1 @[44rem]:col-start-auto @[44rem]:row-start-auto";

/** Название этапа вложенного flow: иконка без выбора и имя текстом — этап правится на странице своего flow. */
function NestedStageName({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  return (
    <span role="cell" className={cn(cell, "relative")}>
      <span className="absolute left-0.5 top-0.5 flex size-6 items-center justify-center text-muted-foreground">
        <StageGlyph icon={stage.icon} fallback={stageIcon(stage)} className="size-3.5" />
      </span>
      <FixedName text={stageLabel(stage, t.stages)} />
    </span>
  );
}

/**
 * Этап «Flow» связкой строк, как этап с под-этапами: в первой строке — только имя вложенного flow текстом (оно живое:
 * переименование flow видно сразу), ниже — по полной строке на каждый его этап, под-этапы тоже: название и чипы, только
 * для чтения. Строки связки отвечают за перетаскивание одним этапом: все несут `data-stage-row` этапа-flow.
 */
function NestedFlowRows({ flowId, ...row }: RowProps & { flowId: string }) {
  const t = useMessages();
  const { settings } = useFlowSettings();
  const flows = settings?.flows ?? [];
  const target = flows.find((flow) => flow.id === flowId);
  const inner = target === undefined ? [] : expandStages(flows, target);
  const { stage, place, catalog } = row;
  const alone = inner.length === 0;
  return (
    <>
      <RowShell {...row} place={{ ...place, edge: alone && place.edge, drop: !alone && place.drop === "bottom" ? null : place.drop }}>
        <StageCells>
          <span role="cell" className={cn(cell, "relative")}>
            {/* Иконка целевого flow, а не этапа: у строки-flow своей иконки этапа нет. */}
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0.5 flex w-6 items-center justify-center">
              <FlowGlyph icon={target?.icon} className="size-3.5 text-muted-foreground" />
            </span>
            <FixedName text={target?.name ?? stage.name} />
          </span>
          {target === undefined && <NestedFlowGone />}
        </StageCells>
      </RowShell>
      {inner.map((innerStage, at) => {
        const last = at === inner.length - 1;
        const drop = place.drop === "whole" || (last && place.drop === "bottom") ? place.drop : null;
        return (
          <RowFrame key={innerStage.id} label={stageLabel(innerStage, t.stages)} stageId={stage.id} place={{ ...place, apart: false, edge: last && place.edge, drop, dropLabel: null }} dragging={row.dragging}>
            <span role="cell" />
            <StageCells>
              <NestedStageName stage={innerStage} />
              <ReadOnlyExecution stage={innerStage} catalog={catalog} />
            </StageCells>
            <span role="cell" className={templateCell} />
            <span role="cell" className={deleteCell} />
          </RowFrame>
        );
      })}
    </>
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
 * «Добавить этап» открывает меню: пустой этап, встроенные этапы-виджеты, другие flow и шаблоны агентских этапов, у шаблона
 * крест. «Добавить скрипт» без шаблонов скриптов сразу ставит пустой скрипт в конец таблицы, с ними — меню из пустого скрипта
 * и шаблонов. Этап из шаблона встаёт в конец таким, каким его сохранили, — вместе с под-этапами.
 * Пустой скрипт — с пустым списком шагов: он скрипт с первой минуты, и плюс в строке открывает меню скрипта.
 */
function AddStageButton({ script }: { script: boolean }) {
  const t = useMessages();
  const update = useStagesUpdate();
  const templates = templatesOfKind(useStageTemplates(), script);
  const own = useContext(FlowIdContext);
  const { settings } = useFlowSettings();
  // Строка «Flow» и виджеты — агентские этапы: у скрипта этих групп нет.
  const nestable = script ? [] : nestableFlows(settings?.flows ?? [], own);
  const widgets = script ? [] : BUILTIN_KINDS;
  // У «Добавить этап» меню всегда — в нём виджеты; у «Добавить скрипт» — только когда есть шаблоны скриптов.
  const menu = !script || templates.length > 0;
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
  const addNested = (flow: Flow) => {
    update((stages) => [...stages, flowStage(flow, stages.map((stage) => stage.id))]);
    close();
  };
  // Убран последний шаблон скрипта — меню «Добавить скрипт» не из чего собирать: оно закрывается, и кнопка снова сразу добавляет пустой скрипт.
  const remove = (index: number) => {
    if (script && templates.length === 1) close();
    updateFlowSettings((s) => ({ ...s, stageTemplates: [...removeTemplate(s.stageTemplates ?? [], index)] }));
  };
  const blank = (): WorkStage => ({ id: newStageId(), kind: "skill", skill: "", name: t.settings.newStage, executors: [] });
  const empty = () => {
    const stage = blank();
    add([script ? { ...stage, automation: { source: "flow", steps: [] } } : stage]);
  };
  return (
    <div ref={root} className="relative">
      <Button variant="secondary" size="sm" aria-expanded={menu ? open : undefined} onClick={() => (menu ? setOpen(!open) : empty())}>
        <Icon name="Plus" aria-hidden="true" />
        {label}
      </Button>
      <FieldOverlay open={open} onClose={close} role="menu" label={label} className="w-[18rem]">
        <button type="button" role="menuitem" onClick={empty} className={overlayItem}>
          <Icon name="Plus" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {script ? t.settings.emptyScript : t.settings.emptyStage}
        </button>
        {widgets.length > 0 && (
          <>
            {menuSeparator}
            <div role="group" aria-label={t.settings.widgets}>
              <div className={groupTitle}>{t.settings.widgets}</div>
              {widgets.map((kind) => (
                <button key={kind} type="button" role="menuitem" onClick={() => add([withWidget(blank(), kind)])} className={overlayItem}>
                  <Icon name={KIND_ICONS[kind]} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  {t.stages[kind]}
                </button>
              ))}
            </div>
          </>
        )}
        {nestable.length > 0 && (
          <>
            {menuSeparator}
            <div role="group" aria-label={t.settings.flowGroup}>
              <div className={groupTitle}>{t.settings.flowGroup}</div>
              {nestable.map((flow) => (
                <button key={flow.id} type="button" role="menuitem" title={flow.name} onClick={() => addNested(flow)} className={cn(overlayItem, "min-w-0")}>
                  <FlowGlyph icon={flow.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{flow.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {templates.length > 0 && (
          <>
            {menuSeparator}
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
          </>
        )}
      </FieldOverlay>
    </div>
  );
}

function Loading({ failed, children }: { failed: boolean; children: ReactNode }) {
  const t = useMessages();
  return failed ? <div className="text-xs text-destructive">{t.settings.loadFailed}</div> : <>{children}</>;
}

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
/** Рамки строк таблицы сверху вниз — для `hoverAt`. */
const rowBoxes = (table: HTMLElement | null): RowBox[] =>
  [...(table?.querySelectorAll<HTMLElement>("[data-stage-row]") ?? [])].map((el) => {
    const { top, bottom } = el.getBoundingClientRect();
    return { id: el.dataset.stageRow!, top, bottom };
  });

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
      last = hoverAt(rowBoxes(table.current), event.clientY);
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
        {stages.map((stage, index) => {
          const row: RowProps = { stage, index, stages, catalog, place: places[index]!, dragging: dragged === stage.id, onGrab: () => grab(stage.id) };
          return stage.flowId === undefined ? <StageRow key={stage.id} {...row} /> : <NestedFlowRows key={stage.id} flowId={stage.flowId} {...row} />;
        })}
      </div>
    </Loading>
  );
}

/** Настройка-переключатель строкой, как числовая; пока настройки не прочитаны — недоступна. */
export function SwitchSetting(props: { label: string; icon?: IconName; checked: boolean | undefined; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-recessed-solid px-3 py-2 text-[13px]">
      {props.icon !== undefined && <Icon name={props.icon} aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1">{props.label}</span>
      <Switch aria-label={props.label} checked={props.checked === true} disabled={props.checked === undefined} onCheckedChange={props.onChange} />
    </label>
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

/**
 * Наказ агенту в реплике после последней попытки: свой наказ владельца, а пока его нет — пустое поле с наказом по умолчанию
 * подсказкой. Набранное сохраняется по уходу фокуса, не длиннее предела схемы; реплика выключена — поле недоступно.
 */
function WakeInstruction({ saved, enabled }: { saved: string | undefined; enabled: boolean }) {
  const t = useMessages();
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? saved ?? "";
  const mentions = useMentions({ value, onText: setTyped, disabled: !enabled });
  const save = () => {
    if (typed !== null && typed.trim() !== (saved ?? "")) updateFlowSettings((s) => withFailureInstruction(s, typed));
    setTyped(null);
  };
  return (
    <>
      <Textarea
        {...mentions.field<HTMLTextAreaElement>({ onBlur: save })}
        aria-label={t.settings.wakeInstruction}
        disabled={!enabled}
        value={value}
        placeholder={DEFAULT_FAILURE_INSTRUCTION}
        maxLength={MAX_WAKE_INSTRUCTION_CHARS}
        onChange={(e) => setTyped(e.target.value)}
        className="min-h-0 resize-none [field-sizing:content] rounded-lg border-0 bg-surface-recessed-solid px-3 py-2 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-inset"
      />
      {mentions.list}
    </>
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
        <SwitchSetting
          label={t.settings.wakeAfterLastRetry}
          checked={settings === null ? undefined : wakesAgentAfterLastRetry(settings)}
          onChange={(wakeAgentAfterLastRetry) => updateFlowSettings((s) => ({ ...s, wakeAgentAfterLastRetry }))}
        />
        <WakeInstruction saved={settings === null ? undefined : (settings.wakeAgentInstruction ?? "")} enabled={settings !== null && wakesAgentAfterLastRetry(settings)} />
        <p className="text-xs text-muted-foreground">{t.settings.wakeAfterLastRetryHint}</p>
      </div>
    </Loading>
  );
}

/** Тумблер очистки контекста после автоматического выбора flow — общий на все flow. */
export function AutoChoiceClear() {
  const t = useMessages();
  const { settings, failed } = useFlowSettings();
  return (
    <Loading failed={failed}>
      <div className="flex flex-col gap-2">
        <SwitchSetting
          label={t.settings.clearAfterAutoChoice}
          checked={settings === null ? undefined : clearsContextAfterAutoChoice(settings)}
          onChange={(clearContextAfterAutoChoice) => updateFlowSettings((s) => ({ ...s, clearContextAfterAutoChoice }))}
        />
        <p className="text-xs text-muted-foreground">{t.settings.clearAfterAutoChoiceHint}</p>
      </div>
    </Loading>
  );
}
