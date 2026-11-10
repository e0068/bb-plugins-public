// Plugins import shared packages as `@bb-plugins/<pkg>`, never `../packages/<pkg>`:
// since bb 0.44 a server build rejects a relative import that leaves the plugin
// directory ("server source import escapes the plugin directory"), while a bare
// specifier is resolved through the plugin's tsconfig `paths` and bundled. Each
// plugin tsconfig maps `"@bb-plugins/*": ["../packages/*"]`; vitest does not read
// tsconfig `paths`, so its configs spread this alias.
import { fileURLToPath } from "node:url";

export const sharedPackagesAlias = {
  "@bb-plugins": fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, ""),
};
