// The analytics page's controls in the topbar row, left of Refresh: the
// filter chips and Filter menu every list has, then the period.
import { Segments } from "../../components/ui/segments";
import { PageFilters } from "../board/toolbar.js";
import { ANALYTICS_WINDOWS, type AnalyticsWindow } from "./default-dashboard";
import { setAnalyticsFilter, useAnalyticsFilter } from "./page-filter";

const WINDOW_TITLE: Record<AnalyticsWindow, string> = { day: "Day", week: "Week", month: "Month", all: "All time" };
/** The period in a narrow topbar, where the full names would push New task off the row. */
const WINDOW_SHORT: Record<AnalyticsWindow, string> = { day: "D", week: "W", month: "M", all: "All" };

export function AnalyticsPageControls({ compact }: { compact: boolean }) {
  const filter = useAnalyticsFilter();
  return (
    <>
      <PageFilters compact={compact} filters={filter.filters} onChange={(filters) => setAnalyticsFilter((current) => ({ ...current, filters }))} />
      <Segments
        label="Period"
        className="shrink-0"
        value={filter.window}
        options={ANALYTICS_WINDOWS.map((window) => ({ value: window, label: WINDOW_TITLE[window], short: WINDOW_SHORT[window] }))}
        onChange={(window) => setAnalyticsFilter((current) => ({ ...current, window }))}
      />
    </>
  );
}
