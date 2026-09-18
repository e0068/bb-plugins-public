// Открытие результата по клику: путь от корня дерева — просмотрщиком дерева
// треда, абсолютный путь — превью bb файлом хранилища или хоста, адрес — браузером bb.
import { useBbNavigate, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";

import { fileTarget, resultLink } from "../core/result-link";
import type { filesRpcContract } from "../shared/contract";
import type { OpenFile } from "./cells";

export function useOpenFile(threadId: string, openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"]): OpenFile {
  const rpc = useRpc<typeof filesRpcContract>();
  const navigate = useBbNavigate();
  return (target) => {
    const link = resultLink(target);
    if (link.kind === "url") navigate.openUrl(link.url);
    else if (link.kind === "workspace") openWorkspaceFile?.(link.path);
    else
      void rpc.call("threadStorage", { threadId }).then(
        (where) => where.kind === "found" && navigate.experimental_openFilePreview({ target: fileTarget(link.path, { threadId, ...where }), location: null }),
        () => undefined,
      );
  };
}
