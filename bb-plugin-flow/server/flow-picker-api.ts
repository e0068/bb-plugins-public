// RPC кнопки flow в композере нового треда: список flow с выбором проекта и
// запись нового выбора. Выбор, чей flow удалён, читается как flow по умолчанию,
// а отказ от flow — как он сам: «без flow» это не удалённый flow.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { flowOrNone, NO_FLOW } from "../core/flows";
import { flowPickerRpcContract } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";
import type { ThreadFlows } from "./thread-flows";

export const registerFlowPickerApi = (bb: Pick<BbPluginApi, "rpc">, settings: FlowSettingsStore, threads: ThreadFlows): void => {
  bb.rpc.register(flowPickerRpcContract, {
    getFlowChoice: async ({ projectId }) => {
      const current = settings.current();
      return { flows: current.flows.map(({ id, name }) => ({ id, name })), selected: flowOrNone(current, threads.choiceOf(projectId))?.id ?? NO_FLOW };
    },
    async setFlowChoice({ projectId, flowId }) {
      if (flowId !== NO_FLOW && !settings.current().flows.some((flow) => flow.id === flowId)) throw new Error(`flow ${flowId} not found`);
      await threads.choose(projectId, flowId);
      return { selected: flowId };
    },
  });
};
