// Pure rule — which of the panel's columns are on screen.
//
// Wide, navigation stands beside the area it navigates. Narrow — a phone —
// there is room for one column, and it is the area: that is what the panel was
// opened for. Navigation comes in over the whole width when the owner asks the
// topbar for it, the way Projects shows one column at a time.
export type VisibleColumns = "all" | "navigation" | "area";

export function visibleColumns({ compact, navOpen }: { compact: boolean; navOpen: boolean }): VisibleColumns {
  if (compact) return navOpen ? "navigation" : "area";
  return navOpen ? "all" : "area";
}
