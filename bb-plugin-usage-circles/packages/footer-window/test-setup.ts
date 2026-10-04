// Node 26 shadows jsdom's localStorage with its own, which stays undefined
// without `--localstorage-file`: an in-memory one stands in, as in bb-plugin-flow.
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
