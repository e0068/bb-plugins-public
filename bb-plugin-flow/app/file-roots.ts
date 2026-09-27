// Корни файлов треда для ссылок результатов: окружение открывает путь от корня
// дерева, хранилище — абсолютный путь. Пока ответа нет — `null`, ссылка не открывается.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";

import type { FileRoots } from "../core/result-link";
import type { filesRpcContract } from "../shared/contract";

export function useFileRoots(threadId: string): FileRoots | null {
  const rpc = useRpc<typeof filesRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [roots, setRoots] = useState<FileRoots | null>(null);
  useEffect(() => {
    let alive = true;
    void rpcRef.current.call("threadFiles", { threadId }).then(
      (found) => alive && setRoots({ threadId, ...found }),
      // Корней нет — ссылки остаются подписью: тост ради них не нужен.
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [threadId]);
  return roots?.threadId === threadId ? roots : null;
}
