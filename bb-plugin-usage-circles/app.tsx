// bb-plugin-usage-circles — frontend entry. Every limit window is its own item
// in BB's sidebar footer, so Customize footer places, hides and reorders each
// ring on its own. The icon of an item is the window's live ring; its window,
// shared with the other footer plugins through @bb-plugins/footer-window,
// lists the provider's limits. An invisible overlay polls the backend and
// hands the answer — usage and ring style — to the icons, which BB renders
// outside any plugin context. The plugin's settings get a Ring section with a
// slider per ring dimension, and a Limits section that picks which limits the
// windows show and in what order. The Usage Limits item shows every limit in
// one grid, as every ring does in the Grid layout; the All limits layout keeps
// only that item — BB registers items once, so the overlay hides the rings.
import { useEffect, useRef } from "react";
import { definePluginApp, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { registerFooterWindow, useOpenOnHover, withFooterWindow } from "@bb-plugins/footer-window";
import {
  ALL_LIMITS_ITEM,
  allLimitsIcon,
  allLimitsPanel,
  FooterPlacement,
  PLUGIN_ID,
  providerPanel,
  publishLayout,
  publishRingStyle,
  publishUsage,
  ringIcon,
  useUsage,
} from "./lib/footer-items";
import { LimitsSettings } from "./lib/limits-settings";
import { RingSettings } from "./lib/ring-settings";
import { DEFAULT_LIMITS, FOOTER_RINGS, layoutOf, type StateWire } from "./lib/usage-model";
import type { rpcContract } from "./server";

const POLL_MS = 60_000;

function UsageFeed() {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const settings = useSettings().values;
  // The logo's place and the layout are settings the backend reads: a change asks again at once.
  const logo = settings?.logo;
  const layout = layoutOf(settings?.layout);
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
  }, [logo, layout]);
  useEffect(() => publishLayout(layout), [layout]);
  useOpenOnHover(PLUGIN_ID, settings?.openOnHover !== false);
  return <FooterPlacement layout={layout} limits={useUsage()?.limits ?? DEFAULT_LIMITS} />;
}

function RingSection() {
  const rpc = useRpc<typeof rpcContract>();
  return <RingSettings save={(dims) => rpc.call("setRingDims", dims)} reset={() => rpc.call("resetRingDims", null)} />;
}

function LimitsSection() {
  const rpc = useRpc<typeof rpcContract>();
  return <LimitsSettings save={(limits) => rpc.call("setLimits", limits)} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "usage-feed", component: UsageFeed });
  app.slots.settingsSection({
    id: "ring",
    title: "Ring",
    description: "Sizes of the footer rings and their logo. The rings follow a slider as it moves.",
    component: RingSection,
  });
  app.slots.settingsSection({
    id: "limits",
    title: "Limits",
    description: "Which limits the windows show, and in what order.",
    component: LimitsSection,
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
  const allIcon = `${PLUGIN_ID}-${ALL_LIMITS_ITEM.id}`;
  const allItem = { pluginId: PLUGIN_ID, itemId: ALL_LIMITS_ITEM.id };
  app.experimental_icons.register({ name: allIcon, component: allLimitsIcon() });
  const allController = app.experimental_sidebarFooter.register({
    kind: "disclosure",
    ...ALL_LIMITS_ITEM,
    icon: allIcon,
    component: withFooterWindow(allLimitsPanel(), allItem),
  });
  registerFooterWindow({ ...allItem, label: ALL_LIMITS_ITEM.label }, allController);
});
