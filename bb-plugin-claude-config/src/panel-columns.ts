// Pure rule — which of the panel's columns are on screen.
//
// Wide, the three stand side by side: the rail of sections, the chosen
// section's list, and the open document. Narrow — a phone — there is room for
// one, and it is the innermost place the owner has opened; each column's own
// way back steps outward again. The same rule Projects lays its panel out by.
export type VisibleColumns = "all" | "sections" | "list" | "document";

export interface ColumnsInput {
  readonly compact: boolean;
  /** A section is chosen, so there is a list to show. */
  readonly hasSection: boolean;
  /** A document — file, skill, hook, workflow — is open. */
  readonly hasOpen: boolean;
}

export function visibleColumns({ compact, hasSection, hasOpen }: ColumnsInput): VisibleColumns {
  if (!compact) return "all";
  if (hasOpen) return "document";
  return hasSection ? "list" : "sections";
}

/**
 * The Workflows section keeps columns of its own: the workflow list, the
 * builder for the open workflow, and the detail of whatever is picked inside
 * it — an agent, a phase header, or the preview of what the tree compiles to.
 * Narrow, the same ladder: one column, the innermost step taken.
 */
export type WorkflowColumns = "all" | "list" | "builder" | "detail";

export interface WorkflowColumnsInput {
  readonly compact: boolean;
  /** A workflow is open — saved or a draft. */
  readonly hasOpen: boolean;
  /** Something inside the open workflow is selected, so there is a detail to show. */
  readonly hasDetail: boolean;
}

export function workflowColumns({ compact, hasOpen, hasDetail }: WorkflowColumnsInput): WorkflowColumns {
  if (!compact) return "all";
  if (!hasOpen) return "list";
  return hasDetail ? "detail" : "builder";
}
