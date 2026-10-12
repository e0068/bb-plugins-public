// Настройка Flow, которую плагин объявляет на сервере и читает на фронте: один ключ и одно описание на обоих концах.

export const FLOWS_IN_PANEL_SETTING = "showFlowsInThreadsPanel";

/** Кладётся в `bb.settings.define({ … })` плагина; выключена, пока владелец её не включит. */
export const flowsInPanelSetting = {
  [FLOWS_IN_PANEL_SETTING]: {
    type: "boolean",
    label: "Show flows in the threads panel",
    description:
      "On the Flow page the threads panel on the left lists the flows instead of the threads, and the rows can be dragged to reorder them; the page's own list is hidden. On a phone the drawer lists the flows too, and the page keeps its own list. It works while Flow's list is the active threads list in Settings → Appearance → Sidebar; if another list is pinned there, this setting does nothing, and while Flow's list is active other plugins' lists (hover previews, an Archived group) give way to bb's own.",
    default: false,
  },
} as const;
