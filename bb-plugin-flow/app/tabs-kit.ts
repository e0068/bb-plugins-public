// Единственный файл плагина, который импортирует Radix Tabs для общего
// сегмент-контрола (./packages/segmented-control). Пакет не импортирует Radix
// значением: плагин, установленный из git, получает node_modules только в своей
// папке, и импорт, написанный в пакете, не нашёлся бы. Здесь он разрешается из
// `dependencies` плагина.
import { List, Root, Trigger } from "@radix-ui/react-tabs";
import type { TabsKit } from "@bb-plugins/segmented-control";

export const tabsKit: TabsKit = { Root, List, Trigger };
