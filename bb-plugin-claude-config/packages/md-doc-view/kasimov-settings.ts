// Чистый общий слой: настройки внешнего вида и флагов редактора Kasimov. Живёт
// в packages/md-doc-view, чтобы оба плагина-потребителя (Cloud Config, MD Opener)
// брали ОДНУ схему, но КАЖДЫЙ хранил СВОИ значения (раздельные настройки: своя
// bb.settings.define + свой useSettings у каждого плагина; межплагинной
// синхронизации нет — так решил владелец, decisions/kasimov-settings-separate).
//
// Одна таблица полей — единственный источник истины; из неё выводятся дескрипторы
// для bb.settings.define, тотальный разбор значений с доски и отображение в
// CSS-переменные (`--kasi-*`) и флаги движка. Эффектов нет: значения приходят от
// useSettings() (фронт), функции только преобразуют.
//
// Кегли/отступы/цвета/шрифты — строками: числового и цветового типа настроек в
// SDK нет (значение настройки — string | boolean). Флаги — булевы. Дефолты
// повторяют packages/kasimov/kasimov.css, поэтому пустая/несозданная настройка
// сохраняет текущий вид.

/** Плоское значение настройки, как его отдаёт useSettings().values. */
export type SettingValue = string | boolean;

export interface KasimovSettings {
  // Внешний вид (CSS-переменные).
  size: string;
  gap: string;
  radius: string;
  font: string;
  mono: string;
  fg: string;
  fgDim: string;
  bg: string;
  cellBg: string;
  accent: string;
  // Флаги движка.
  followLinks: boolean;
  frontmatter: boolean;
}

type CssField = keyof Omit<KasimovSettings, "followLinks" | "frontmatter">;
type FlagField = "followLinks" | "frontmatter";

interface CssSpec {
  field: CssField;
  /** Ключ настройки на доске bb (уникален в пределах плагина). */
  key: string;
  /** CSS custom property, которую задаёт значение. */
  cssVar: string;
  default: string;
  label: string;
  description?: string;
}

interface FlagSpec {
  field: FlagField;
  key: string;
  default: boolean;
  label: string;
  description?: string;
}

// Дефолты — из packages/kasimov/kasimov.css.
export const CSS_FIELDS: readonly CssSpec[] = [
  {
    field: "size",
    key: "kasimovFontSize",
    cssVar: "--kasi-size",
    default: "14px",
    label: "Kasimov: кегль текста",
    description: "Размер шрифта редактора, напр. 14px",
  },
  {
    field: "gap",
    key: "kasimovGap",
    cssVar: "--kasi-gap",
    default: "4px",
    label: "Kasimov: отступ",
    description: "Базовый вертикальный интервал блоков, напр. 4px",
  },
  {
    field: "radius",
    key: "kasimovRadius",
    cssVar: "--kasi-radius",
    default: "8px",
    label: "Kasimov: скругление",
    description: "Радиус скругления панелей/кода, напр. 8px",
  },
  {
    field: "font",
    key: "kasimovFont",
    cssVar: "--kasi-font",
    default:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    label: "Kasimov: основной шрифт",
    description: "font-family для текста",
  },
  {
    field: "mono",
    key: "kasimovMono",
    cssVar: "--kasi-mono",
    default: "ui-monospace, SFMono-Regular, Menlo, monospace",
    label: "Kasimov: моноширинный шрифт",
    description: "font-family для кода",
  },
  {
    field: "fg",
    key: "kasimovFg",
    cssVar: "--kasi-fg",
    default: "#e8e8ea",
    label: "Kasimov: цвет текста",
  },
  {
    field: "fgDim",
    key: "kasimovFgDim",
    cssVar: "--kasi-fg-dim",
    default: "rgba(255, 255, 255, .5)",
    label: "Kasimov: цвет приглушённого текста",
  },
  {
    field: "bg",
    key: "kasimovBg",
    cssVar: "--kasi-bg",
    default: "#0e0e0e",
    label: "Kasimov: цвет фона (внутренние панели)",
  },
  {
    field: "cellBg",
    key: "kasimovCellBg",
    cssVar: "--kasi-cell-bg",
    default: "#1c1c1e",
    label: "Kasimov: цвет ячеек/кода",
  },
  {
    field: "accent",
    key: "kasimovAccent",
    cssVar: "--kasi-accent",
    default: "#d1603d",
    label: "Kasimov: акцентный цвет (ссылки)",
  },
];

export const FLAG_FIELDS: readonly FlagSpec[] = [
  {
    field: "followLinks",
    key: "kasimovFollowLinks",
    default: true,
    label: "Kasimov: переход по ссылкам",
    description: "Клик по живой ссылке ведёт по ней вместо выделения токена",
  },
  {
    field: "frontmatter",
    key: "kasimovFrontmatter",
    default: true,
    label: "Kasimov: показывать frontmatter",
    description: "Показывать блок frontmatter сеткой (значение сохраняется)",
  },
];

/** Дефолтные настройки — из таблиц полей (совпадают с kasimov.css). */
export const DEFAULTS: KasimovSettings = {
  ...(Object.fromEntries(
    CSS_FIELDS.map((f) => [f.field, f.default]),
  ) as Record<CssField, string>),
  ...(Object.fromEntries(
    FLAG_FIELDS.map((f) => [f.field, f.default]),
  ) as Record<FlagField, boolean>),
};

/** Дескрипторы для bb.settings.define (плоский объект key → дескриптор). */
export const descriptors = {
  ...Object.fromEntries(
    CSS_FIELDS.map((f) => [
      f.key,
      {
        type: "string" as const,
        label: f.label,
        ...(f.description ? { description: f.description } : {}),
        default: f.default,
      },
    ]),
  ),
  ...Object.fromEntries(
    FLAG_FIELDS.map((f) => [
      f.key,
      {
        type: "boolean" as const,
        label: f.label,
        ...(f.description ? { description: f.description } : {}),
        default: f.default,
      },
    ]),
  ),
};

/**
 * Тотальный разбор значений с доски в настройки: берём значение нужного типа,
 * иначе — дефолт. `values` может быть undefined (грузится) — тогда всё дефолтное.
 * Мусор и лишние ключи отбрасываются самим устройством разбора (читаем только
 * известные ключи).
 */
export function parse(
  values: Record<string, SettingValue> | undefined,
): KasimovSettings {
  const v = values ?? {};
  const css = Object.fromEntries(
    CSS_FIELDS.map((f) => {
      const raw = v[f.key];
      return [f.field, typeof raw === "string" ? raw : f.default];
    }),
  ) as Record<CssField, string>;
  const flags = Object.fromEntries(
    FLAG_FIELDS.map((f) => {
      const raw = v[f.key];
      return [f.field, typeof raw === "boolean" ? raw : f.default];
    }),
  ) as Record<FlagField, boolean>;
  return { ...css, ...flags };
}

/** CSS custom properties для host-элемента: только непустые значения (пусто = дефолт CSS). */
export function toCssVars(s: KasimovSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CSS_FIELDS) {
    const value = s[f.field];
    if (value !== "") out[f.cssVar] = value;
  }
  return out;
}

/** Флаги движка для KasimovEditor. */
export function toFlags(s: KasimovSettings): {
  followLinks: boolean;
  frontmatter: boolean;
} {
  return { followLinks: s.followLinks, frontmatter: s.frontmatter };
}
