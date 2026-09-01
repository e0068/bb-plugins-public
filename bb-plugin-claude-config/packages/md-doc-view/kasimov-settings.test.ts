import { describe, expect, it } from "vitest";
import {
  CSS_FIELDS,
  DEFAULTS,
  FLAG_FIELDS,
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  TOKEN_SELECT_FIELDS,
  buildDescriptors,
  descriptors,
  kasimovCssRule,
  parse,
  toCssVars,
  toFlags,
  withUnit,
  type KasimovSettings,
  type SettingValue,
} from "./kasimov-settings";

const CUSTOM_TOKEN = "custom";

describe("DEFAULTS", () => {
  it("совпадают с дефолтами таблиц полей", () => {
    for (const f of CSS_FIELDS) expect(DEFAULTS[f.field]).toBe(f.default);
    for (const f of FLAG_FIELDS) expect(DEFAULTS[f.field]).toBe(f.default);
  });

  it("пресеты по умолчанию — custom (текстовое поле рулит, поведение как раньше)", () => {
    for (const t of TOKEN_SELECT_FIELDS) expect(DEFAULTS[t.field]).toBe(CUSTOM_TOKEN);
  });

  // Три таблицы полей — единственный источник истины для формы KasimovSettings;
  // поле, забытое в одной из таблиц (или интерфейсе), не должно проходить
  // незамеченным — DEFAULTS/parse строятся через `as Record<...>`, который сам
  // по себе такой дрейф не ловит.
  it("ключи DEFAULTS равны объединению полей трёх таблиц (гейт от дрейфа типов)", () => {
    const expected = [
      ...CSS_FIELDS.map((f) => f.field),
      ...TOKEN_SELECT_FIELDS.map((t) => t.field),
      ...FLAG_FIELDS.map((f) => f.field),
    ];
    expect(new Set(Object.keys(DEFAULTS))).toEqual(new Set(expected));
    expect(Object.keys(DEFAULTS)).toHaveLength(expected.length);
  });
});

describe("descriptors", () => {
  it("строковые поля — type string, флаги — type boolean, с дефолтом", () => {
    for (const f of CSS_FIELDS) {
      const d = descriptors[f.key];
      expect(d).toMatchObject({ type: "string", label: f.label, default: f.default });
    }
    for (const f of FLAG_FIELDS) {
      const d = descriptors[f.key];
      expect(d).toMatchObject({ type: "boolean", label: f.label, default: f.default });
    }
  });

  it("пресеты — type select, custom первым в options, дефолт custom", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      const d = descriptors[t.key] as {
        type: string;
        label: string;
        options: string[];
        default: string;
      };
      expect(d).toMatchObject({ type: "select", label: t.label, default: CUSTOM_TOKEN });
      expect(d.options[0]).toBe(CUSTOM_TOKEN);
      expect(d.options.slice(1)).toEqual(t.options);
    }
  });

  it("ключи настроек уникальны", () => {
    const keys = [...CSS_FIELDS, ...TOKEN_SELECT_FIELDS, ...FLAG_FIELDS].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Порядок в объекте определяет порядок в UI Settings (см. buildDescriptors
  // ниже): select-пресет обязан идти НЕПОСРЕДСТВЕННО перед своим текстовым
  // полем — его собственное описание обещает «поле ниже», и это обязано быть
  // буквально так, а не где-то в хвосте списка через дюжину чужих настроек.
  it("select-пресет идёт сразу перед текстовым полем, которое он переопределяет", () => {
    const order = Object.keys(descriptors);
    for (const t of TOKEN_SELECT_FIELDS) {
      const target = CSS_FIELDS.find((f) => f.field === t.target)!;
      expect(order.indexOf(target.key)).toBe(order.indexOf(t.key) + 1);
    }
  });
});

describe("buildDescriptors", () => {
  it("без аргумента — то же самое, что экспортированный descriptors", () => {
    expect(buildDescriptors()).toEqual(descriptors);
  });

  it("override меняет default только у переданного поля, у остальных остаётся custom", () => {
    const overridden = buildDescriptors({ fgToken: "var(--foreground)" });
    expect(
      (overridden.kasimovFgToken as { default: string }).default,
    ).toBe("var(--foreground)");
    for (const t of TOKEN_SELECT_FIELDS) {
      if (t.field === "fgToken") continue;
      expect((overridden[t.key] as { default: string }).default).toBe(CUSTOM_TOKEN);
    }
  });

  it("override за пределами options всё равно попадает в default дескриптора (ответственность вызывающего)", () => {
    // buildDescriptors — внутренний конфигурационный API (вызывающие — только
    // server.ts плагинов, не доска настроек), поэтому он не обязан быть
    // тотальным к произвольной строке — в отличие от parse(), разбирающего
    // недоверенные данные с доски.
    const overridden = buildDescriptors({ accentToken: "var(--not-in-list)" });
    expect((overridden.kasimovAccentToken as { default: string }).default).toBe(
      "var(--not-in-list)",
    );
  });

  // NATIVE_VIEWER_TOKEN_DEFAULTS — публичная константа, общая для обоих
  // server.ts (md-opener/claude-config); если список токенов когда-нибудь
  // сократят, а константу забудут поправить, buildDescriptors() её не
  // отвергнет (см. тест выше — override не проверяется на членство). Значит
  // единственное место, ловящее протухание, — этот тест.
  it("NATIVE_VIEWER_TOKEN_DEFAULTS — каждое значение реально входит в options своего поля", () => {
    for (const [field, value] of Object.entries(NATIVE_VIEWER_TOKEN_DEFAULTS)) {
      const spec = TOKEN_SELECT_FIELDS.find((t) => t.field === field)!;
      expect(spec.options).toContain(value);
    }
  });

  // Тип Record<TokenField, string> (не Partial) уже заставляет tsc отвергнуть
  // недостающее поле — этот тест дублирует гарантию в рантайме, чтобы дрейф
  // ловился и без прогона tsc (напр. локальным `vitest --watch`).
  it("NATIVE_VIEWER_TOKEN_DEFAULTS покрывает все поля TOKEN_SELECT_FIELDS, ни одно не пропущено", () => {
    const expected = TOKEN_SELECT_FIELDS.map((t) => t.field).sort();
    expect(Object.keys(NATIVE_VIEWER_TOKEN_DEFAULTS).sort()).toEqual(expected);
  });
});

describe("parse", () => {
  it("undefined → все дефолты", () => {
    expect(parse(undefined)).toEqual(DEFAULTS);
  });

  it("пустой объект → все дефолты", () => {
    expect(parse({})).toEqual(DEFAULTS);
  });

  it("валидное значение каждого поля применяется", () => {
    for (const f of CSS_FIELDS) {
      expect(parse({ [f.key]: "ЗНАЧ" })[f.field]).toBe("ЗНАЧ");
    }
    for (const t of TOKEN_SELECT_FIELDS) {
      expect(parse({ [t.key]: t.options[0] })[t.field]).toBe(t.options[0]);
    }
    for (const f of FLAG_FIELDS) {
      const flipped = !f.default;
      expect(parse({ [f.key]: flipped })[f.field]).toBe(flipped);
    }
  });

  it("значение неверного типа падает на дефолт (тотальность)", () => {
    for (const f of CSS_FIELDS) {
      expect(parse({ [f.key]: true })[f.field]).toBe(f.default);
    }
    for (const t of TOKEN_SELECT_FIELDS) {
      expect(parse({ [t.key]: true })[t.field]).toBe(CUSTOM_TOKEN);
    }
    for (const f of FLAG_FIELDS) {
      expect(parse({ [f.key]: "да" })[f.field]).toBe(f.default);
    }
  });

  it("неизвестные ключи отбрасываются", () => {
    const values: Record<string, SettingValue> = { мусор: "x", другое: true };
    expect(parse(values)).toEqual(DEFAULTS);
  });

  // Регресс-тест на находку код-ревью: пресет — строка, но не сам по себе
  // валидная CSS-переменная — значение на доске должно быть ∈ [CUSTOM_TOKEN,
  // ...options], а не произвольная строка. Список options наблюдаемый, не
  // официальный (см. комментарий у HOST_COLOR_TOKENS) — его будут править, и
  // протухшее старое значение на чьей-то доске не должно долететь до CSS как
  // есть (тот же класс тихой поломки, что чинили в первой части задачи).
  it("пресет вне options (протухшее значение) падает на custom, а не летит в CSS", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      expect(parse({ [t.key]: "var(--obsolete-token)" })[t.field]).toBe(CUSTOM_TOKEN);
      expect(parse({ [t.key]: "" })[t.field]).toBe(CUSTOM_TOKEN);
    }
  });
});

describe("withUnit", () => {
  it.each([
    ["8", "8px"],
    ["8.5", "8.5px"],
    ["-8", "-8px"],
    ["0", "0px"],
  ])("голое число %s → %s", (raw, expected) => {
    expect(withUnit(raw, "px")).toBe(expected);
  });

  it.each([
    ["8px", "8px"],
    ["8rem", "8rem"],
    ["8%", "8%"],
    ["auto", "auto"],
    ["none", "none"],
    ["", ""],
  ])("значение с единицей/ключевым словом/пустое не меняется: %s", (raw, expected) => {
    expect(withUnit(raw, "px")).toBe(expected);
  });
});

describe("toCssVars", () => {
  it("дефолты дают все CSS-переменные с их значениями", () => {
    const vars = toCssVars(DEFAULTS);
    for (const f of CSS_FIELDS) {
      const expected = f.unit ? withUnit(f.default, f.unit) : f.default;
      expect(vars[f.cssVar]).toBe(expected);
    }
    expect(Object.keys(vars)).toHaveLength(CSS_FIELDS.length);
  });

  it("пустое значение поля исключает его переменную (пусто = дефолт CSS)", () => {
    const s: KasimovSettings = { ...DEFAULTS, size: "" };
    const vars = toCssVars(s);
    expect(vars["--kasi-size"]).toBeUndefined();
    expect(Object.keys(vars)).toHaveLength(CSS_FIELDS.length - 1);
  });

  // Поля настроек принимают голое число — пользователь не обязан писать
  // единицу измерения руками; toCssVars дописывает px там, где кегль/отступ/
  // ширина её ожидают. Безразмерные (lineHeight) и не-числовые (шрифты,
  // цвета) поля не тронуты; уже указанная единица/ключевое слово (px/auto/
  // none) остаётся как есть.
  it.each([
    ["size", "18", "--kasi-size", "18px"],
    ["gap", "6", "--kasi-gap", "6px"],
    ["radius", "10", "--kasi-radius", "10px"],
    ["maxWidth", "720", "--kasi-max-width", "720px"],
    ["colMx", "20", "--kasi-col-mx", "20px"],
    ["padX", "32", "--kasi-pad-x", "32px"],
    ["paraGap", "8", "--kasi-para-gap", "8px"],
    ["listGap", "4", "--kasi-list-gap", "4px"],
  ] as const)("%s: голое число %s → %s: %s", (field, raw, cssVar, expected) => {
    const s: KasimovSettings = { ...DEFAULTS, [field]: raw };
    expect(toCssVars(s)[cssVar]).toBe(expected);
  });

  it("значение с уже указанной единицей/ключевым словом не меняется", () => {
    const s: KasimovSettings = {
      ...DEFAULTS,
      size: "1.2rem",
      maxWidth: "none",
      colMx: "auto",
      padX: "5%",
    };
    const vars = toCssVars(s);
    expect(vars["--kasi-size"]).toBe("1.2rem");
    expect(vars["--kasi-max-width"]).toBe("none");
    expect(vars["--kasi-col-mx"]).toBe("auto");
    expect(vars["--kasi-pad-x"]).toBe("5%");
  });

  it("lineHeight безразмерный — голое число px не получает", () => {
    const s: KasimovSettings = { ...DEFAULTS, lineHeight: "1.8" };
    expect(toCssVars(s)["--kasi-line-height"]).toBe("1.8");
  });

  // Пресет (select) перекрывает текстовое поле, пока не стоит на "custom" —
  // ровно то поведение, которое просил владелец: выбрал шрифт/токен из
  // списка — редактор берёт его, а не то, что написано в текстовом поле рядом.
  it("пресет отличный от custom перекрывает текстовое поле — на каждой цели", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      const cssVar = CSS_FIELDS.find((f) => f.field === t.target)!.cssVar;
      const preset = t.options[0];
      const s: KasimovSettings = {
        ...DEFAULTS,
        [t.target]: "ЭТО-ДОЛЖНО-БЫТЬ-ПРОИГНОРИРОВАНО",
        [t.field]: preset,
      };
      expect(toCssVars(s)[cssVar]).toBe(preset);
    }
  });

  it("пресет custom — используется текстовое поле, как раньше — на каждой цели", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      const cssVar = CSS_FIELDS.find((f) => f.field === t.target)!.cssVar;
      const s: KasimovSettings = {
        ...DEFAULTS,
        [t.target]: "ОЖИДАЕМОЕ-ЗНАЧЕНИЕ",
        [t.field]: CUSTOM_TOKEN,
      };
      expect(toCssVars(s)[cssVar]).toBe("ОЖИДАЕМОЕ-ЗНАЧЕНИЕ");
    }
  });

  // toCssVars — самостоятельная чистая функция над KasimovSettings, не только
  // над результатом parse() (который уже сузил пресет до {custom, ...options});
  // здесь собранный руками объект с "" в поле пресета — защитная ветка должна
  // отработать так же, как custom, а не протечь "" в CSS.
  it("пустое значение пресета (собранное в обход parse) тоже уходит на текстовое поле", () => {
    const s: KasimovSettings = { ...DEFAULTS, fg: "#123456", fgToken: "" };
    expect(toCssVars(s)["--kasi-fg"]).toBe("#123456");
  });
});

describe("toFlags", () => {
  it("отражает булевы флаги движка на всех комбинациях", () => {
    for (const followLinks of [true, false]) {
      for (const frontmatter of [true, false]) {
        for (const atLinks of [true, false]) {
          const s: KasimovSettings = {
            ...DEFAULTS,
            followLinks,
            frontmatter,
            atLinks,
          };
          expect(toFlags(s)).toMatchObject({ followLinks, frontmatter, atLinks });
        }
      }
    }
  });

  it("mermaidContrast → строковый mermaidNodes движка", () => {
    expect(toFlags({ ...DEFAULTS, mermaidContrast: true }).mermaidNodes).toBe(
      "contrast",
    );
    expect(toFlags({ ...DEFAULTS, mermaidContrast: false }).mermaidNodes).toBe(
      "soft",
    );
  });
});

describe("kasimovCssRule", () => {
  it("пустой набор переменных → null", () => {
    expect(kasimovCssRule("kasi-host-1", {})).toBeNull();
  });

  it("собирает правило по ID-селектору, целящееся в .mde-root", () => {
    const rule = kasimovCssRule("kasi-host-1", {
      "--kasi-size": "18px",
      "--kasi-accent": "#0af",
    });
    expect(rule).toBe(
      "#kasi-host-1 .mde-root { --kasi-size: 18px; --kasi-accent: #0af; }",
    );
  });

  // Значения приходят голыми строками с доски настроек, без валидации формы —
  // символ, способный закрыть правило раньше времени и вылезти в соседний
  // CSS, тотально отбрасывается, а не долетает до document.head как есть.
  it.each([
    ["значение с }", { "--kasi-size": "1px } * { display: none " }],
    ["значение с {", { "--kasi-size": "1px { evil: 1" }],
    ["значение с ;", { "--kasi-size": "1px; --evil: 1" }],
    ["значение с <", { "--kasi-size": "1<px" }],
    ["значение с >", { "--kasi-size": "1>px" }],
    ["имя переменной с }", { "--kasi-size}x": "18px" }],
  ])("отбрасывает пару: %s", (_label, vars) => {
    expect(kasimovCssRule("kasi-host-1", vars)).toBeNull();
  });

  it("отбрасывает только небезопасную пару, безопасные остаются", () => {
    const rule = kasimovCssRule("kasi-host-1", {
      "--kasi-size": "1px } * { display: none ",
      "--kasi-accent": "#0af",
    });
    expect(rule).toBe("#kasi-host-1 .mde-root { --kasi-accent: #0af; }");
  });

  it("результат никогда не содержит внутренних `}` — закрывающая всегда одна", () => {
    const adversarial = [
      "1px",
      "1px }",
      "} } }",
      "1px; } * { color:red",
      "normal",
    ];
    for (const value of adversarial) {
      const rule = kasimovCssRule("kasi-host-1", { "--kasi-size": value });
      if (rule === null) continue;
      expect(rule.indexOf("}")).toBe(rule.length - 1);
    }
  });
});
