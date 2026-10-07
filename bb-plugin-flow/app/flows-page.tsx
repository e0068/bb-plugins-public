// Страница Flow в левом меню bb: выбранный flow — имя и описание «когда
// выбирать» правятся на месте, таблица его этапов, под ней одной строкой —
// «Добавить этап» слева и «Удалить flow» справа, а ниже — переключатели ограничений навыков и агентов. Слева от названия — выбор
// иконки flow. Сам выбор и создание — плоским списком слева (./flows-list); на узкой панели страница в два уровня: без
// выбранного flow виден только список, с выбранным — только он и «Назад» над ним. Общее на все flow — ширина кнопки и выбор flow
// агентом — в настройках плагина (./flow-settings-sections). Страницу листает
// её корень целиком, вместе со списком: рамок со своей прокруткой внутри нет.
// Выбранный flow живёт в адресе страницы, чтобы ссылка открывала его; адрес
// `history` вместо flow открывает историю прогонов (./run-history). Своей
// ширины содержимое не держит: таблица этапов сама перестраивается по ширине
// контейнера и на телефоне встаёт в колонку — держать её широкой раскладке
// 46rem значило бы листать страницу вбок там, где листать некуда.
import { useState } from "react";
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { describeFlow, flowById, limitFlow, removeFlow, renameFlow, setFlowIcon } from "../core/flows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import type { Flow } from "../shared/contract";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "../lib/panel-path";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings, useFlowSettingsLive } from "./stage-settings-store";
import { AddStage, SwitchSetting, WorkStagesTable } from "./stage-settings";
import { SKILL_ICON } from "./stage-icons";
import { HISTORY_SUB_PATH, RunHistory } from "./run-history";
import { FlowsList } from "./flows-list";
import { FlowGlyph } from "./flow-glyph";
import { StageIconPicker } from "./stage-icon-picker";

export function FlowsPage(props: PluginNavPanelProps) {
  return (
    <LocaleProvider>
      <ProviderLogosProvider>
        <Flows {...props} />
      </ProviderLogosProvider>
    </LocaleProvider>
  );
}

/** Имя выбранного flow правкой на месте. */
function FlowName({ flow }: { flow: Flow }) {
  const t = useMessages();
  const [name, setName] = useState<string | null>(null);
  const save = () => {
    if (name !== null) updateFlowSettings((s) => renameFlow(s, flow.id, name));
    setName(null);
  };
  return (
    <Input
      aria-label={t.flows.name}
      value={name ?? flow.name}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-9 min-h-9 max-md:pointer-coarse:h-9 w-full min-w-0 rounded-md border-0 bg-card pl-1.5 pr-2.5 py-0 text-lg font-semibold shadow-none focus-visible:ring-1 focus-visible:ring-inset"
    />
  );
}

/** Описание «когда выбирать» под названием: сохраняется по уходу фокуса и уходит в правило выбора flow, по которому агент выбирает flow треду с «Автоматически». */
function FlowDescription({ flow }: { flow: Flow }) {
  const t = useMessages();
  const [description, setDescription] = useState<string | null>(null);
  const save = () => {
    if (description !== null) updateFlowSettings((s) => describeFlow(s, flow.id, description));
    setDescription(null);
  };
  return (
    <Textarea
      aria-label={t.flows.description}
      placeholder={t.flows.descriptionPlaceholder}
      value={description ?? flow.description ?? ""}
      onChange={(e) => setDescription(e.target.value)}
      onBlur={save}
      className="min-h-0 max-md:pointer-coarse:text-[13px] resize-none [field-sizing:content] rounded-md border-0 bg-card px-2.5 py-1.5 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-inset"
    />
  );
}

/**
 * Переключатели под кнопками этапов, рядом друг с другом, а на узкой панели — один под другим: какие навыки и агенты
 * Claude Code грузит агенту треда этого flow (../server/skill-scope.ts). Иконки те же, что у навыка и агента в таблице этапов.
 */
function FlowLimits({ flow }: { flow: Flow }) {
  const t = useMessages();
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-1 @lg:grid-cols-2">
        <SwitchSetting label={t.flows.limitSkills} icon={SKILL_ICON} checked={flow.limitSkills === true} onChange={(limitSkills) => updateFlowSettings((s) => limitFlow(s, flow.id, { limitSkills }))} />
        <SwitchSetting label={t.flows.limitAgents} icon="Bot" checked={flow.limitAgents === true} onChange={(limitAgents) => updateFlowSettings((s) => limitFlow(s, flow.id, { limitAgents }))} />
      </div>
      <p className="text-xs text-subtle-foreground">{t.flows.limitsHint}</p>
    </div>
  );
}

/** Удаление flow под таблицей справа: первый клик спрашивает, второй удаляет — этапы не должны пропадать с одного промаха. */
function DeleteFlow({ flow }: { flow: Flow }) {
  const t = useMessages();
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button variant="secondary" size="sm" aria-label={t.flows.remove(flow.name)} onClick={() => setAsking(true)} className="text-destructive">
        {t.flows.removeAction}
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-[13px]">{t.flows.removeQuestion(flow.name)}</p>
      <Button variant="destructive" size="sm" onClick={() => updateFlowSettings((s) => removeFlow(s, flow.id))}>
        {t.flows.removeYes}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        {t.flows.removeNo}
      </Button>
    </div>
  );
}

/** «Назад» со второго уровня на узкой панели: слева сверху над правой колонкой, на широкой не нужен — список рядом. */
function BackToList() {
  const t = useMessages();
  const navigate = useBbNavigate();
  return (
    <Button variant="ghost" size="sm" onClick={() => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: "" })} className="self-start text-muted-foreground @3xl:hidden">
      <Icon name="ChevronLeft" aria-hidden="true" className="size-4" />
      {t.flows.back}
    </Button>
  );
}

function Flows({ subPath }: PluginNavPanelProps) {
  useFlowSettingsLive();
  // Второй уровень узкой панели: адрес с выбранным flow (или историей) открывает правую колонку, пустой — список.
  const second = subPath !== "";
  return (
    <div className="@container h-full overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-4 p-6 @3xl:flex-row @3xl:items-start @3xl:gap-6">
        <FlowsList subPath={subPath} className={cn("@3xl:w-56 @3xl:shrink-0", second && "@max-3xl:hidden")} />
        <div className={cn("flex min-w-0 flex-1 flex-col gap-4", !second && "@max-3xl:hidden")}>
          <BackToList />
          {subPath === HISTORY_SUB_PATH ? <RunHistory /> : <FlowEditor subPath={subPath} />}
        </div>
      </div>
    </div>
  );
}

function FlowEditor({ subPath }: { subPath: string }) {
  const t = useMessages();
  const { settings } = useFlowSettings();
  if (settings === null) return <div aria-busy="true" />;
  // Выбранный flow приходит адресом панели: его пишет лента в начале страницы, а кнопки
  // «назад» и «вперёд» браузера ходят по той же истории.
  const flow = flowById(settings, subPath);
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div key={flow.id} className="flex flex-col gap-1">
        <div className="flex items-center">
          <StageIconPicker large icon={flow.icon} fallback="Workflow" fallbackGlyph={(className) => <FlowGlyph className={className} />} name={flow.name} onPick={(icon) => updateFlowSettings((s) => setFlowIcon(s, flow.id, icon))} />
          <FlowName flow={flow} />
        </div>
        <FlowDescription flow={flow} />
      </div>
      <div className="flex flex-col gap-2">
        <WorkStagesTable flowId={flow.id} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AddStage flowId={flow.id} />
          {settings.flows.length > 1 && <DeleteFlow key={flow.id} flow={flow} />}
        </div>
      </div>
      <FlowLimits flow={flow} />
    </section>
  );
}
