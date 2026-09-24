// Страница Flow в левом меню bb: выбранный flow — имя и описание «когда
// выбирать» правятся на месте, таблица его этапов и удаление flow внизу. Сам
// выбор и создание — в шапке панели (./flows-header); общее на все flow — ширина
// кнопки и выбор flow агентом — в настройках плагина (./flow-settings-sections).
// Выбранный flow живёт в адресе страницы, чтобы ссылка открывала его; адрес
// `history` вместо flow открывает историю прогонов (./run-history). Своей
// ширины содержимое не держит: таблица этапов сама перестраивается по ширине
// контейнера и на телефоне встаёт в колонку — держать её широкой раскладке
// 46rem значило бы листать страницу вбок там, где листать некуда.
import { useState } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { describeFlow, flowById, removeFlow, renameFlow } from "../core/flows";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import type { Flow } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";
import { WorkStagesTable } from "./stage-settings";
import { HISTORY_SUB_PATH, RunHistory } from "./run-history";

export const FLOWS_PANEL_PATH = "flows";

export function FlowsPage(props: PluginNavPanelProps) {
  return (
    <LocaleProvider>
      <ProviderLogosProvider>
        <Flows {...props} />
      </ProviderLogosProvider>
    </LocaleProvider>
  );
}

/**
 * Имя выбранного flow правкой на месте. Рамка фокуса рисуется внутрь поля
 * (`ring-inset`): поле стоит вплотную к краю области с прокруткой, и снаружи
 * её срезало бы слева, справа и сверху.
 */
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
      className="h-9 min-h-9 w-full min-w-0 rounded-md border-0 bg-card px-2.5 py-0 text-lg font-semibold shadow-none focus-visible:ring-1 focus-visible:ring-inset"
    />
  );
}

/** Описание «когда выбирать» под названием: сохраняется по уходу фокуса и уходит в корневой навык, по которому агент выбирает flow. */
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
      rows={2}
      value={description ?? flow.description ?? ""}
      onChange={(e) => setDescription(e.target.value)}
      onBlur={save}
      className="min-h-0 resize-none rounded-md border-0 bg-card px-2.5 py-1.5 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-inset"
    />
  );
}

/** Удаление flow внизу страницы: первый клик спрашивает, второй удаляет — этапы не должны пропадать с одного промаха. */
function DeleteFlow({ flow }: { flow: Flow }) {
  const t = useMessages();
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button variant="outline" size="sm" aria-label={t.flows.remove(flow.name)} onClick={() => setAsking(true)} className="text-muted-foreground hover:text-destructive">
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

function Flows({ subPath }: PluginNavPanelProps) {
  if (subPath === HISTORY_SUB_PATH) return <RunHistory />;
  return <FlowEditor subPath={subPath} />;
}

function FlowEditor({ subPath }: { subPath: string }) {
  const t = useMessages();
  const { settings } = useFlowSettings();
  if (settings === null) return <div aria-busy="true" className="p-6" />;
  // Выбранный flow приходит адресом панели: его пишет лента в шапке, а кнопки
  // «назад» и «вперёд» браузера ходят по той же истории.
  const flow = flowById(settings, subPath);
  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <section className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="flex min-w-0 flex-col gap-4">
          <div key={flow.id} className="flex flex-col gap-1">
            <FlowName flow={flow} />
            <FlowDescription flow={flow} />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-[13px] font-medium">{t.settings.stagesTitle}</h2>
            <p className="text-xs text-muted-foreground">{t.settings.stagesDescription}</p>
            <WorkStagesTable flowId={flow.id} />
          </div>
          {settings.flows.length > 1 && (
            <div className="mt-2 border-t border-border pt-4">
              <DeleteFlow key={flow.id} flow={flow} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
