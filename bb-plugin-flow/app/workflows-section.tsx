// Раздел Workflows страницы Flow: слева — workflow Claude Code из `~/.claude/workflows` и «Новый workflow», справа —
// конструктор выбранного (тот же редактор файла, что открывает чип этапа в правой панели, ./workflow-opener). Workflow,
// который конструктор не читает деревом, помечен в списке и правится справа как код. Открытый workflow живёт в адресе
// страницы (`workflows/<имя>`), так что ссылка открывает его, а «Назад» браузера ходит по выбору.
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { NAME_RE } from "@bb-plugins/workflow-builder/model";

import { workflowsSubPath, type WorkflowsPlace } from "../core/workflows-route";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "../lib/panel-path";
import type { workflowFilesRpcContract } from "../shared/contract";
import { ACTIVE_ROW, ROW } from "./flows-list";
import { useMessages } from "./locale-context";
import { WorkflowFile } from "./workflow-opener";

type Listing = { state: "loading" } | { state: "failed" } | { state: "ready"; dir: string; items: Array<{ name: string; path: string; description: string; reason: string | null }> };

export function WorkflowsSection({ place }: { place: WorkflowsPlace }) {
  const t = useMessages();
  const rpc = useRpc<typeof workflowFilesRpcContract>();
  const navigate = useBbNavigate();
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const go = (next: WorkflowsPlace) => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: workflowsSubPath(next) });

  const refresh = useCallback(
    () =>
      void rpc.call("workflowList", null).then(
        (list) => setListing({ state: "ready", ...list }),
        () => setListing({ state: "failed" }),
      ),
    [rpc],
  );
  useEffect(refresh, [refresh]);

  const opened = place.kind === "open" ? place.name : null;
  const second = place.kind !== "list";
  return (
    <div className="@container flex h-full min-h-0">
      <aside className={cn("flex min-h-0 w-full flex-col gap-0.5 overflow-y-auto px-2 py-6 @3xl:w-60 @3xl:shrink-0 @3xl:border-r @3xl:border-border", second && "@max-3xl:hidden")}>
        <div className="mb-1 flex items-center justify-between pl-7 pr-1">
          <h2 className="text-[13px] font-semibold">{t.workflows.list}</h2>
          <Button asChild variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground">
            <button type="button" aria-label={t.workflows.add} title={t.workflows.add} onClick={() => go({ kind: "new" })}>
              <Icon name="Plus" aria-hidden="true" className="size-4" />
            </button>
          </Button>
        </div>
        <nav aria-label={t.workflows.list} className="flex flex-col gap-0.5">
          {listing.state === "failed" && <p className="pl-7 text-xs text-muted-foreground">{t.workflows.failed}</p>}
          {listing.state === "ready" && listing.items.length === 0 && <p className="pl-7 text-xs text-muted-foreground">{t.workflows.empty}</p>}
          {listing.state === "ready" &&
            listing.items.map((item) => (
              <button
                key={item.path}
                type="button"
                aria-current={item.name === opened ? "page" : undefined}
                onClick={() => go({ kind: "open", name: item.name })}
                title={item.description || item.name}
                className={cn(ROW, item.name === opened && ACTIVE_ROW)}
              >
                <Icon name="Workflow" aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{item.name}</span>
                {item.reason !== null && <span className="ml-auto shrink-0 text-xs text-subtle-foreground">{t.workflows.codeOnly}</span>}
              </button>
            ))}
        </nav>
      </aside>
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !second && "@max-3xl:hidden")}>
        {second && (
          <Button variant="ghost" size="sm" onClick={() => go({ kind: "list" })} className="m-2 self-start text-muted-foreground @3xl:hidden">
            <Icon name="ChevronLeft" aria-hidden="true" className="size-4" />
            {t.workflows.back}
          </Button>
        )}
        {listing.state === "ready" && place.kind === "open" && (
          <WorkflowFile key={place.name} path={`${listing.dir}/${place.name}.js`} engine="claude" onSaved={refresh} />
        )}
        {listing.state === "ready" && place.kind === "new" && (
          <NewWorkflow taken={listing.items.map((item) => item.name)} onCreate={(name) => go({ kind: "open", name })} dir={listing.dir} onSaved={refresh} />
        )}
        {place.kind === "list" && <p className="m-auto px-4 text-center text-sm text-muted-foreground">{t.workflows.pick}</p>}
      </section>
    </div>
  );
}

/** Новый workflow: сперва имя файла, потом пустой конструктор; первое сохранение создаёт файл и открывает его в списке. */
function NewWorkflow({ taken, dir, onCreate, onSaved }: { taken: string[]; dir: string; onCreate: (name: string) => void; onSaved: () => void }) {
  const t = useMessages();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const trimmed = name.trim();
  const problem = trimmed === "" ? null : !NAME_RE.test(trimmed) ? t.workflows.nameHint : taken.includes(trimmed) ? t.workflows.nameTaken : null;
  if (chosen !== null)
    return (
      <WorkflowFile
        path={`${dir}/${chosen}.js`}
        engine="claude"
        create
        onSaved={() => {
          onSaved();
          onCreate(chosen);
        }}
      />
    );
  return (
    <form
      className="flex max-w-md flex-col gap-2 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "" && problem === null) setChosen(trimmed);
      }}
    >
      <label className="text-[13px] font-semibold" htmlFor="new-workflow-name">
        {t.workflows.name}
      </label>
      <Input id="new-workflow-name" autoFocus value={name} placeholder={t.workflows.namePlaceholder} onChange={(e) => setName(e.target.value)} />
      <p className={cn("text-xs", problem === null ? "text-subtle-foreground" : "text-destructive")}>{problem ?? t.workflows.nameHint}</p>
      <Button type="submit" size="sm" className="self-start" disabled={trimmed === "" || problem !== null}>
        {t.workflows.create}
      </Button>
    </form>
  );
}
