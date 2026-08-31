// bb-plugin-md-opener — слот fileOpener: .md открывается редактором Kasimov.
// Рендер и вся интерактивность (стек прыжков в ТОЙ ЖЕ вкладке, правка, CAS) живут
// в общем слое packages/md-doc-view; здесь только тонкая проводка RPC под его
// контракт — load/save/resolveLinkTarget замыкают непрозрачный `source` вкладки.
// Резолв путей/хоста и разметку живости ссылок считает server.ts.
import { useRef } from "react";
import { definePluginApp, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";

import { MdDocView } from "./packages/md-doc-view";
import type { LoadedDoc, SaveResult } from "./packages/md-doc-view";
import {
  parseKasimovSettings,
  kasimovCssVars,
  kasimovFlags,
} from "./packages/md-doc-view";
import {
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
import type { rpcContract } from "./server";

function DocOpener({ path, source }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  // Свой вид и флаги Kasimov — из настроек этого плагина (раздельные с Cloud
  // Config). parse тотален: пока useSettings грузится — дефолты из kasimov.css.
  const settings = parseKasimovSettings(useSettings().values);
  const vars = kasimovCssVars(settings);
  const flags = kasimovFlags(settings);
  // Карта живых ссылок последнего прочитанного документа: href → abs (с сервера,
  // `~` уже раскрыт). resolveLinkTarget берёт abs отсюда, не резолвя `~` сам.
  const linksRef = useRef<Map<string, string>>(new Map());

  const load = async (target: string): Promise<LoadedDoc> => {
    const res = await rpc.call("readDoc", { path: target, source });
    linksRef.current = new Map(res.links.map((l) => [l.href, l.abs]));
    return {
      path: res.path,
      content: res.content,
      sha256: res.sha256,
      error: res.error,
    };
  };

  const save = (
    target: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<SaveResult> =>
    rpc.call("writeDoc", { path: target, source, content, expectedSha256 });

  // Все внутривкладочные ссылки кликабельны (как в родном вьюере); внешняя (http)
  // — null. Единый резолвер (memory/decisions/link-resolve-shared-layer.md).
  const resolveLinkTarget = (href: string, fromPath: string): string | null =>
    isInTabLink(href)
      ? linksRef.current.get(href) ??
        resolveRelative(fromPath, parseHref(href).path)
      : null;

  // Смена файла ИЛИ вкладки-источника пересобирает вид (стек/черновик). Ключ — по
  // ПРИМИТИВАМ source, не по объекту: хост может пересоздать source тем же по
  // значению, и это не должно ронять вкладку (memory/wiki/bb-plugin-file-opener-slot.md).
  const resetKey = `${path}|${source.kind}|${source.threadId}|${source.environmentId}|${source.projectId}`;

  return (
    <MdDocView
      key={resetKey}
      initialPath={path}
      load={load}
      save={save}
      resolveLinkTarget={resolveLinkTarget}
      vars={vars}
      followLinks={flags.followLinks}
      frontmatter={flags.frontmatter}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "md-opener",
    title: "Kasimov",
    extensions: ["md", "markdown"],
    component: DocOpener,
  });
});
