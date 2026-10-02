// Слой 1 (чистое) — мешок пропсов, на который замыкается фабрика kit.
//
// Фабрика kit читает пропсы один раз при создании и дальше держит ссылку на
// переданный объект (кнопка перечитывает его в `_refresh`, меню — при открытии).
// Чтобы React-пропсы доходили до элемента, мешок живёт дольше рендеров:
//   • функции кладутся трамплинами — вызов уходит в самый свежий проп;
//   • объекты (menu, num) кладутся живыми представлениями — чтение поля уходит
//     в самый свежий проп, поэтому меню kit открывается с актуальными пунктами;
//   • остальное копируется по значению; исчезнувший проп исчезает из мешка.
// Подпись — то, что фабрика без `_refresh` увидит только при пересоздании:
// значения не-функций и ответ `get()`, если он есть.

export type Bag = Record<string, unknown>;
export type Latest = { readonly current: Bag };

const isFn = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === "function";
const isPlainObject = (v: unknown): v is Bag =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const trampoline = (latest: Latest, key: string) =>
  (...args: unknown[]) => {
    const fn = latest.current[key];
    return isFn(fn) ? fn(...args) : undefined;
  };

// kit читает у объектов только поля (menu.title, menu.items, num.min …), поэтому
// ловушка одна: перечисление ключей представлению не обещано.
const liveView = (latest: Latest, key: string): Bag =>
  new Proxy({} as Bag, {
    get: (_, field) => (latest.current[key] as Bag | undefined)?.[field as string],
  });

/** Привести мешок к свежим пропсам, не меняя его identity. */
export function syncBag(bag: Bag, latest: Latest): void {
  const props = latest.current;
  for (const key of Object.keys(bag)) if (!(key in props)) delete bag[key];
  for (const [key, value] of Object.entries(props)) {
    if (isFn(value)) {
      if (!isFn(bag[key])) bag[key] = trampoline(latest, key);
    } else if (isPlainObject(value)) {
      if (!isPlainObject(bag[key])) bag[key] = liveView(latest, key);
    } else {
      bag[key] = value;
    }
  }
}

/** Подпись значений: не-функции плюс ответ get(). Разная подпись — разный элемент у фабрики без _refresh. */
export function signatureOf(props: Bag): string {
  const values = Object.entries(props)
    .filter(([, v]) => !isFn(v))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const get = props.get;
  return JSON.stringify(values) + "|" + (isFn(get) ? String(get()) : "");
}
