// Public entry point of the package — re-exports all three tiers. A server
// that doesn't need react imports directly from "./resolve" (or
// "@bb-plugins/link-navigation/resolve"), bypassing this file and not pulling in the react tier.
export {
  isInTabLink,
  parseHref,
  resolveRelative,
  fileRefFromCode,
} from "./resolve";

export {
  initStack,
  jumpTo,
  goBack,
  current,
  canGoBack,
} from "./jump-stack";
export type { JumpState } from "./jump-stack";

export { useJumpStack, makeLinkResolver } from "./nav";
