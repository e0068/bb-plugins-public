// Слой 1 — типизированный фасад над вендоренной копией kit Cellular (vendor/).
// Копию кладёт и обновляет апдейтер самой Cellular (npm run update); руками она
// не правится — vendor.test.ts сверяет каждый файл с манифестом по sha256. Здесь
// только типы поверх фабрик и версия копии; поведение целиком в kit.
import * as kit from "./vendor/index.js";
import manifest from "./vendor/manifest.json";

/** Версия kit, лежащая в vendor/ — из манифеста поставки. */
export const version: string = manifest.version;

/** Элемент фабрики kit. `_refresh` перечитывает пропсы, с которыми элемент создан (есть у кнопки). */
export type KitElement = HTMLElement & { _refresh?: () => void };

/** Элемент текстового режима input(): kit кладёт однострочное поле в `_input` (vendor/input.js, inputPlain: c._input = i). */
export type TextInputElement = KitElement & { _input: HTMLInputElement };

export type SegmentOption = { text?: string; html?: string; title?: string };

export type MenuItem =
  | { type?: undefined; label: string; icon?: string; title?: string; onSelect?: (item: MenuItem, index: number) => void }
  | { type: "segment"; options: SegmentOption[]; current?: number; onSelect?: (index: number) => void }
  | { type: "slider"; label?: string; icon?: string; min?: number; max?: number; step?: number; int?: boolean; value?: number; onInput?: (value: number) => void }
  | { type: "switch"; label?: string; value?: boolean; onSelect?: (value: boolean) => void };

export type MenuSpec = {
  title?: string;
  cols?: 1 | 2;
  items: MenuItem[];
  current?: number;
  onSelect?: (item: MenuItem, index: number) => void;
};

export type MenuController = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  contains(node: Node): boolean;
};

export type ButtonProps = {
  label?: string;
  value?: string | number | null;
  title?: string;
  /** SVG-разметка иконки слева/справа от подписи (.blendico). */
  leftIcon?: string;
  rightIcon?: string;
  /** Клик переключает нажатое состояние (.on) через get/set. */
  toggle?: boolean;
  showSwitch?: boolean;
  /** Клик открывает меню `menu`. */
  hasMenu?: boolean;
  menu?: MenuSpec;
  get?: () => boolean;
  set?: (on: boolean) => void;
  onClick?: () => void;
};

export type NumSpec = { min?: number; max?: number; step?: number; default?: number; slider?: boolean; int?: boolean; exp?: boolean };

export type InputProps = {
  label?: string;
  placeholder?: string;
  valueAlign?: "left" | "center" | "right";
  leftIcon?: string;
  rightIcon?: string;
  /** Числовой режим (слайдер — его подрежим); без него поле текстовое. */
  num?: NumSpec;
  hasMenu?: boolean;
  menu?: MenuSpec;
  get?: () => number;
  set?: (value: number) => void;
};

export type SegmentProps = {
  items: { label?: string; icon?: string }[];
  value?: number;
  onSelect?: (index: number) => void;
  /** Вертикальная стопка вместо строки. */
  col?: boolean;
};

export type SwitchProps = { label?: string; get: () => boolean; set: (on: boolean) => void };

export type CellProps = {
  label?: string;
  value?: string | number;
  head?: boolean;
  /** Обработчик клика; делает ячейку интерактивной (role=button, tabindex, Enter/Space). */
  act?: (event: Event) => void;
  icon?: string;
  title?: string;
};

export const button = (props: ButtonProps): KitElement => kit.button(props);
export const input = (props: InputProps): KitElement => kit.input(props);
export const segment = (props: SegmentProps): HTMLElement => kit.segment(props);
export const toggle = (props: SwitchProps): HTMLLabelElement => kit.toggle(props);
export const uiCell = (props: CellProps): KitElement => kit.uiCell(props);
export const uiRow = (): HTMLDivElement => kit.uiRow();
export const uiMenu = (anchor: HTMLElement, menu: MenuSpec, guard?: HTMLElement): MenuController =>
  kit.uiMenu(anchor, menu, guard);
export const attachMenu = (row: HTMLElement, menu: MenuSpec, icon?: HTMLElement | null): void =>
  kit.attachMenu(row, menu, icon);
export const makeActivatable = (el: HTMLElement, handler: (event: Event) => void): void =>
  kit.makeActivatable(el, handler);
