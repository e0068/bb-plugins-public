// bb-plugin-zz-pull-request — the plugin entry point: registers the thread
// header buttons, the sidebar row-status content script and the settings
// section with the triggers-and-actions rules. Nothing else lives here.
//
// Every button is its own file in src/ui/header-buttons/. They form one state
// machine over a thread's git/PR phase, and the rightmost header slot shows
// exactly one of the chain at a time:
//
//   Pull Request → Merge → (main not pulled) → Done & Archive
//
// with two buttons beside the chain: Fast Forward (branch behind main) and
// Wake Up (environment retiring, overrides all). The shared subscription
// machinery every button leans on is src/ui/header-button-state.tsx.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AutomationSection } from "./src/ui/automation-section";
import { ThreadHeaderActions } from "./src/ui/header-buttons/thread-actions";
import { PreviewToastListener } from "./src/ui/preview-toast-listener";
import { registerRowStatus } from "./src/content/row-status-content";

export default definePluginApp((app) => {
  // Dev tool, not a button: a headless listener that shows a toast pushed by
  // the `bb pr-toast` CLI command (server.ts / src/core/preview-toast.ts). It
  // renders nothing; registering it as a header action just gets it mounted
  // whenever a thread header is on screen.
  app.slots.experimental_threadHeaderAction({
    id: "preview-toast-listener",
    title: "Preview toast listener (dev)",
    component: PreviewToastListener,
  });
  // One slot for all five buttons (Wake Up, Fast Forward, Pull Request,
  // Merge, Done & Archive) instead of one slot each: bb wraps every
  // registered action in its own flex-item span, gap apart, even when the
  // component renders null — five registrations meant up to four invisible
  // spans still eating gaps between whichever buttons actually showed. A
  // single component composing all five as plain React children collapses
  // null ones to nothing, so visible buttons always sit exactly one gap
  // apart from each other and from bb's own controls next to them. See
  // ./src/ui/header-buttons/thread-actions.tsx.
  app.slots.experimental_threadHeaderAction({
    id: "thread-actions",
    title: "Pull Request thread actions",
    component: ThreadHeaderActions,
  });
  // A headless content script that paints each sidebar thread row with the
  // PR-work glyph (uncommitted / committed / PR open / conflict / reviewed /
  // merged). Separate surface from the header buttons above; all its logic
  // lives in src/content and src/core/row-status.
  registerRowStatus(app);
  // The plugin's machinery as a table on its settings page: which trigger runs
  // which actions, showing a button included (src/core/automation.ts).
  app.slots.settingsSection({
    id: "automation",
    title: "Триггеры и действия",
    description: "На каждый триггер плагин находит все строки, где он есть, и выполняет их действия по порядку. Кнопка на своих триггерах перепроверяет условие показа, уведомления отбирают тосты клика.",
    component: AutomationSection,
  });
});
