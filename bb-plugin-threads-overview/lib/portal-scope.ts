declare const __BB_PLUGIN_ID__: string | undefined;

/**
 * The attributes that put a node rendered outside the plugin's root back in
 * its scope: bb builds every class of the plugin's stylesheet behind them, so
 * a node without them draws bare.
 */
export function portalScopeProps(): {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root"?: "";
  "data-bb-plugin"?: string;
} {
  const pluginId =
    typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;
  return {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
    ...(pluginId !== undefined ? { "data-bb-plugin": pluginId } : {}),
  };
}

export const usePortalScopeProps = portalScopeProps;
