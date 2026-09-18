// Черновики брифов живут в localStorage окна. Node 26 перекрывает localStorage
// jsdom своим, а без `--localstorage-file` тот пуст — ставится хранилище в памяти.
// Между тестами оно очищается, иначе черновик одного теста всплывает в следующем.
import { afterEach } from "vitest";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
}

if (typeof window !== "undefined" && globalThis.localStorage === undefined)
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });

// Язык системы в тестах вида — русский: интерфейс по умолчанию идёт за языком браузера, а jsdom сказал бы en-US.
// Английский тест включает настройкой плагина.
if (typeof window !== "undefined") {
  Object.defineProperty(window.navigator, "languages", { value: ["ru-RU"], configurable: true });
  Object.defineProperty(window.navigator, "language", { value: "ru-RU", configurable: true });
}

afterEach(() => {
  globalThis.localStorage?.clear();
});
