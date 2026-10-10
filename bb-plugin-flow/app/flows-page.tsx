// Страница Flow в левом меню bb: адрес `none` открывает «Без flow» — только описание «когда flow не нужен»; выбранный flow —
// имя и описание «когда выбирать» правятся на месте, таблица его этапов, под ней одной строкой —
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
import { useBbNavigate, useRpc, useSettings, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useFollowSelectedThread } from "@bb-plugins/rail-collapse";

import { describeFlow, describeNoFlow, flowById, limitFlow, NO_FLOW, removeFlow, renameFlow, setFlowIcon } from "../core/flows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import type { Flow, threadFlowRpcContract } from "../shared/contract";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "../lib/panel-path";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { useMessages } from "./locale-context";
import { MentionsProvider, useMentions } from "./mentions";
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
        <MentionsProvider>
          <Flows {...props} />
        </MentionsProvider>
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

/** Поле описания под названием: черновик живёт до ухода фокуса, тогда уходит в `onSave`. */
function DescriptionField({ label, placeholder, saved, onSave }: { label: string; placeholder: string; saved: string | undefined; onSave: (text: string) => void }) {
  const [description, setDescription] = useState<string | null>(null);
  const value = description ?? saved ?? "";
  const mentions = useMentions({ value, onText: setDescription });
  const save = () => {
    if (description !== null) onSave(description);
    setDescription(null);
  };
  return (
    <>
      <Textarea
        {...mentions.field<HTMLTextAreaElement>({ onBlur: save })}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setDescription(e.target.value)}
        className="min-h-0 max-md:pointer-coarse:text-[13px] resize-none [field-sizing:content] rounded-md border-0 bg-card px-2.5 py-1.5 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-inset"
      />
      {mentions.list}
    </>
  );
}

/** Описание «когда выбирать» под названием: уходит в правило выбора flow, по которому агент выбирает flow треду с «Автоматически». */
function FlowDescription({ flow }: { flow: Flow }) {
  const t = useMessages();
  return <DescriptionField label={t.flows.description} placeholder={t.flows.descriptionPlaceholder} saved={flow.description} onSave={(text) => updateFlowSettings((s) => describeFlow(s, flow.id, text))} />;
}

/**
 * «Без flow»: имя и знак встроенные, правится только описание — агент читает его первым пунктом выбора flow, раньше описаний
 * flow.
 */
function NoFlowEditor({ saved }: { saved: string | undefined }) {
  const t = useMessages();
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <div className="flex h-9 items-center">
        <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
          <FlowGlyph crossed className="size-7" />
        </span>
        <h2 className="truncate pl-1.5 text-lg font-semibold">{t.flows.pickerNone}</h2>
      </div>
      <DescriptionField label={t.flows.noFlowDescription} placeholder={t.flows.noFlowDescriptionPlaceholder} saved={saved} onSave={(text) => updateFlowSettings((s) => describeNoFlow(s, text))} />
      <p className="px-2.5 pt-1 text-xs text-subtle-foreground">{t.flows.noFlowHint}</p>
    </section>
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

/** С «Show the selected thread» страница открывает flow треда, с которого пришёл владелец или по которому кликнул в панели тредов. */
function useSelectedThreadFlow(subPath: string) {
  const rpc = useRpc<typeof threadFlowRpcContract>();
  const navigate = useBbNavigate();
  useFollowSelectedThread(useSettings, subPath === "", {
    resolve: (threadId) =>
      rpc.call("threadFlow", { threadId }).then(({ flowId }) =>
        flowId === null ? null : () => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: flowId, replace: true }),
      ),
    openThread: (threadId) => navigate.toThread(threadId),
  });
}

function Flows({ subPath }: PluginNavPanelProps) {
  useFlowSettingsLive();
  useSelectedThreadFlow(subPath);
  // Второй уровень узкой панели: адрес с выбранным flow (или историей) открывает правую колонку, пустой — список.
  const second = subPath !== "";
  return (
    <div className="@container h-full overflow-y-auto">
      {/* Список стоит в 8 px от краёв колонки, как строки тредов в левой панели bb; справа от строк до редактора те же 8 px, что и слева. */}
      <div className="flex min-w-0 flex-col @3xl:flex-row @3xl:items-start">
        <FlowsList subPath={subPath} className={cn("px-2 py-6 @3xl:w-60 @3xl:shrink-0", second && "@max-3xl:hidden")} />
        <div className={cn("flex min-w-0 flex-1 flex-col gap-4 p-6 @3xl:pl-0", !second && "@max-3xl:hidden")}>
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
  if (subPath === NO_FLOW) return <NoFlowEditor saved={settings.noFlowDescription} />;
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
