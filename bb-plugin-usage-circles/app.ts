// bb-plugin-usage-circles — frontend entry. The widget lives in the sidebar
// footer, which has no rich-content plugin slot (only the single-icon-button
// sidebarFooterAction), so it mounts through a trusted content script instead
// of a React slot — see lib/sidebar-widget.ts for why and how. No JSX here:
// the widget is plain DOM, so this stays a .ts file, not .tsx.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountSidebarUsageCircles } from "./lib/sidebar-widget";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "sidebar-usage-circles",
    mount({ pluginId, signal }) {
      return mountSidebarUsageCircles(pluginId, signal);
    },
  });
});
