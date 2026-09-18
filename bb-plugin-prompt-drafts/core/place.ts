// Слой 1 — чистое ядро: снимок места черновика из области композера и живого
// сайдбара. Типы сайдбара здесь узкие и свои: ядро не знает SDK.
import type { Place } from "./drafts";

export interface SidebarView {
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly threads: readonly {
    readonly id: string;
    readonly projectId: string;
    readonly title: string | null;
    readonly titleFallback: string | null;
    readonly environment: { readonly name: string | null; readonly branchName: string | null } | null;
  }[];
}

/** Черновик сохраняют либо в треде, либо в композере Home с его проектом. */
export type Where = { readonly threadId: string } | { readonly projectId: string | null };

const projectName = (sidebar: SidebarView, projectId: string | null): string | null =>
  sidebar.projects.find((project) => project.id === projectId)?.name ?? null;

export function placeOf(where: Where, sidebar: SidebarView): Place {
  if (!("threadId" in where)) {
    return {
      threadId: null,
      threadTitle: null,
      projectId: where.projectId,
      projectName: projectName(sidebar, where.projectId),
      worktree: null,
      branch: null,
    };
  }
  const thread = sidebar.threads.find((item) => item.id === where.threadId);
  const projectId = thread?.projectId ?? null;
  return {
    threadId: where.threadId,
    threadTitle: thread ? (thread.title ?? thread.titleFallback) : null,
    projectId,
    projectName: projectName(sidebar, projectId),
    worktree: thread?.environment?.name ?? null,
    branch: thread?.environment?.branchName ?? null,
  };
}
