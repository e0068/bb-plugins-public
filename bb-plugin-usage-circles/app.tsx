// bb-plugin-usage-circles — frontend entry. Every limit window is its own item
// in BB's sidebar footer, so Customize footer places, hides and reorders each
// ring on its own. The icon of an item is the window's live ring; its window,
// shared with the other footer plugins through @bb-plugins/footer-window,
// lists the provider's limits. An invisible overlay polls the backend and
// hands the answer — usage and ring style — to the icons, which BB renders
// outside any plugin context. The plugin's settings get a Ring section with a
// slider per ring dimension.
import { useEffect, useRef } from "react";
import { definePluginApp, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { registerFooterWindow, useOpenOnHover, withFooterWindow } from "@bb-plugins/footer-window";
import { providerPanel, publishRingStyle, publishUsage, ringIcon } from "./lib/footer-items";
import { RingSettings } from "./lib/ring-settings";
import { FOOTER_RINGS, type StateWire } from "./lib/usage-model";
import type { rpcContract } from "./server";

const PLUGIN_ID = "usage-circles";
const POLL_MS = 60_000;

function UsageFeed() {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const settings = useSettings().values;
  // The logo's place is a setting the backend reads: a change asks again at once.
  const logo = settings?.logo;
  useEffect(() => {
    let alive = true;
    // A failed poll keeps the last answer: the rings stay as they were.
    const load = () =>
      rpcRef.current.call("getState", null).then(
        (state: StateWire) => {
          if (!alive) return;
          publishUsage(state);
          publishRingStyle(state.ring);
        },
        () => undefined,
      );
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [logo]);
  useOpenOnHover(PLUGIN_ID, settings?.openOnHover !== false);
  return null;
}

function RingSection() {
  const rpc = useRpc<typeof rpcContract>();
  return <RingSettings save={(dims) => rpc.call("setRingDims", dims)} reset={() => rpc.call("resetRingDims", null)} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "usage-feed", component: UsageFeed });
  app.slots.settingsSection({
    id: "ring",
    title: "Ring",
    description: "Sizes of the footer rings and their logo. The rings follow a slider as it moves.",
    component: RingSection,
  });
  for (const ring of FOOTER_RINGS) {
    const icon = `${PLUGIN_ID}-${ring.id}`;
    const item = { pluginId: PLUGIN_ID, itemId: ring.id };
    app.experimental_icons.register({ name: icon, component: ringIcon(ring) });
    const controller = app.experimental_sidebarFooter.register({
      kind: "disclosure",
      id: ring.id,
      label: ring.label,
      icon,
      component: withFooterWindow(providerPanel(ring.providerId, ring.kind, `${ring.label.split(" — ")[0]} Limits`), item),
    });
    registerFooterWindow({ ...item, label: ring.label }, controller);
  }
});
