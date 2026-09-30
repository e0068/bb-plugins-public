// RPC кнопки flow в композере нового треда: список flow с выбором проекта и
// запись нового выбора. Выбор, чей flow удалён, читается как flow по умолчанию,
// а «Автоматически» и отказ от flow — как они сами: это не удалённые flow.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { AUTO_FLOW, flowOrNone, NO_FLOW } from "../core/flows";
import { flowPickerRpcContract } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";
import type { ThreadFlows } from "./thread-flows";

export const registerFlowPickerApi = (bb: Pick<BbPluginApi, "rpc">, settings: FlowSettingsStore, threads: ThreadFlows): void => {
  bb.rpc.register(flowPickerRpcContract, {
    getFlowChoice: async ({ projectId }) => {
      const current = settings.current();
      const choice = threads.choiceOf(projectId);
      return { flows: current.flows.map(({ id, name }) => ({ id, name })), selected: choice === AUTO_FLOW ? AUTO_FLOW : (flowOrNone(current, choice)?.id ?? NO_FLOW) };
    },
    async setFlowChoice({ projectId, flowId }) {
      if (flowId !== NO_FLOW && flowId !== AUTO_FLOW && !settings.current().flows.some((flow) => flow.id === flowId)) throw new Error(`flow ${flowId} not found`);
      await threads.choose(projectId, flowId);
      return { selected: flowId };
    },
  });
};
