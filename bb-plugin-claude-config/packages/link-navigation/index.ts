// Публичный вход пакета — реэкспорт всех трёх ярусов. Сервер, которому react
// не нужен, импортирует напрямую из "./resolve" (или "@bb-plugins/link-navigation/resolve"),
// минуя этот файл и не затягивая react-ярус.
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
