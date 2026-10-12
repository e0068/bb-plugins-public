// Блок «Агент» на странице Flow: модель треда этого flow выбором модели bb и стартовое сообщение агенту. Тот же блок —
// у строки «Автоматически». Выключенный переключатель — модели нет, тред идёт моделью композера; включение засевает
// выбор моделью по умолчанию с машины bb: выбору нужно настоящее значение.
import { useState, type ReactNode } from "react";
import { experimental_ProviderModelPicker as ProviderModelPicker, useRpc } from "@get-bb/plugin-sdk/app";

import type { AgentSettings, Execution, flowSettingsRpcContract } from "../shared/contract";
import { useMessages } from "./locale-context";
import { SwitchSetting } from "./stage-settings";

export function AgentBlock({ agent, onSave, messageField }: { agent: AgentSettings | undefined; onSave: (agent: AgentSettings) => void; messageField: ReactNode }) {
  const t = useMessages();
  const rpc = useRpc<typeof flowSettingsRpcContract>();
  const [failed, setFailed] = useState(false);
  const execution = agent?.execution;
  const setExecution = (next: Execution | undefined) => {
    const { execution: _, ...rest } = agent ?? {};
    onSave(next === undefined ? rest : { ...rest, execution: next });
  };
  const toggle = (on: boolean) => {
    setFailed(false);
    if (!on) return setExecution(undefined);
    void rpc.call("defaultExecution", {}).then(
      (seed) => (seed === null ? setFailed(true) : setExecution(seed)),
      () => setFailed(true),
    );
  };
  return (
    <section aria-label={t.flows.agent} className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{t.flows.agent}</h3>
      <SwitchSetting label={t.flows.ownModel} icon="Bot" checked={execution !== undefined} onChange={toggle} />
      {failed && <p className="text-xs text-destructive">{t.flows.modelsFailed}</p>}
      {execution !== undefined && (
        <ProviderModelPicker
          value={execution}
          onChange={(value) => setExecution({ providerId: value.providerId, model: value.model, reasoningLevel: value.reasoningLevel, ...(value.serviceTier === undefined ? {} : { serviceTier: value.serviceTier }) })}
        />
      )}
      {messageField}
      <p className="text-xs text-subtle-foreground">{t.flows.agentHint}</p>
    </section>
  );
}
