// Dev-only headless listener: shows a preview toast published by the
// `bb pr-toast` CLI command (see src/core/preview-toast.ts and server.ts). It
// is registered as a thread-header action that renders nothing — it exists
// only to subscribe, so it mounts whenever a thread header is on screen.
// Realtime is broadcast to every connected frontend, so one mounted listener
// is enough; the payload is validated before it becomes a toast.
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { asPreviewToast, PREVIEW_TOAST_CHANNEL } from "@/src/core/preview-toast";
import { useNotify } from "@/src/ui/notify";

export function PreviewToastListener(): null {
  const notify = useNotify();
  useRealtime(PREVIEW_TOAST_CHANNEL, (payload) => {
    const toast = asPreviewToast(payload);
    if (toast) notify(toast);
  });
  return null;
}
