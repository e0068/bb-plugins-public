// Секция настроек: путь журнала решений по проекту. Список проектов и их
// путей читается один раз при показе; каждое поле сохраняется по уходу
// фокуса и держит свою ошибку — правка одного проекта не трогает другие.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import type { journalSettingsRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

type Rpc = ReturnType<typeof useRpc<typeof journalSettingsRpcContract>>;
type Project = { id: string; name: string; path: string | null };

const field = "h-8 font-mono text-xs";

type SaveError = "absolute" | "traversal" | "network";

const reasonText = (t: ReturnType<typeof useMessages>["settings"], reason: SaveError): string => {
  if (reason === "absolute") return t.journalInvalidAbsolute;
  if (reason === "traversal") return t.journalInvalidTraversal;
  return t.journalSaveFailed;
};

function ProjectRow({ rpc, project, onSaved }: { rpc: Rpc; project: Project; onSaved: (path: string | null) => void }) {
  const t = useMessages().settings;
  const [value, setValue] = useState(project.path ?? "");
  const [error, setError] = useState<SaveError | null>(null);
  const save = async () => {
    if (value === (project.path ?? "")) return;
    try {
      const result = await rpc.call("setJournalDir", { projectId: project.id, path: value });
      if (result.kind === "invalid") {
        setError(result.reason);
        return;
      }
      setError(null);
      onSaved(result.path);
    } catch {
      // Путь остаётся набранным: владелец видит причину и может нажать ещё раз, не перепечатывая.
      setError("network");
    }
  };
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-3">
      <span className="truncate text-sm font-medium">{project.name}</span>
      <div className="flex flex-col gap-1">
        <Input aria-label={project.name} placeholder={t.journalPathPlaceholder} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} className={cn(field, error !== null && "border-destructive")} />
        {error !== null ? <span className="text-xs text-destructive">{reasonText(t, error)}</span> : value === "" ? <span className="text-xs text-muted-foreground">{t.journalEmptyHint}</span> : null}
      </div>
    </div>
  );
}

function JournalDirsList() {
  const t = useMessages().settings;
  const rpc = useRpc<typeof journalSettingsRpcContract>();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    rpc
      .call("getJournalProjects", {})
      .then((next) => alive && setProjects(next))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [rpc]);

  if (failed) return <div className="text-xs text-destructive">{t.journalLoadFailed}</div>;
  if (projects === null) return null;
  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <ProjectRow key={project.id} rpc={rpc} project={project} onSaved={(path) => setProjects((prev) => prev?.map((p) => (p.id === project.id ? { ...p, path } : p)) ?? prev)} />
      ))}
    </div>
  );
}

export function JournalDirsSection() {
  return (
    <LocaleProvider>
      <JournalDirsList />
    </LocaleProvider>
  );
}
