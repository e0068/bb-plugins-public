// The booleans each plugin declares with bb.settings.define and reads on the
// frontend: one key and one wording for all of them.

export const RAIL_COLLAPSE_SETTING = "collapseThreadsFromRail";

/** Spread into the plugin's `bb.settings.define({ … })`; off until the owner turns it on. */
export const railCollapseSetting = {
  [RAIL_COLLAPSE_SETTING]: {
    type: "boolean",
    label: "Collapse the threads panel from the rail",
    description:
      "Clicking this plugin's icon in the left rail collapses the threads panel; leaving for a thread opens it again.",
    default: false,
  },
} as const;

export const SELECTED_THREAD_SETTING = "showSelectedThread";

/**
 * Spread into the plugin's `bb.settings.define({ … })`; off until the owner
 * turns it on. `shows` names what the page opens for a thread — "its task".
 */
export const selectedThreadSetting = (shows: string) =>
  ({
    [SELECTED_THREAD_SETTING]: {
      type: "boolean",
      label: "Show the selected thread",
      description: `Opening this plugin shows ${shows} of the thread you came from; clicking a thread in the threads panel switches the page to it.`,
      default: false,
    },
  }) as const;
