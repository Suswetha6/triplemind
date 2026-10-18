// Minimal localStorage stand-in so zustand's persist middleware behaves the
// same way under test as it does in the browser.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

globalThis.localStorage = new MemoryStorage();

// zustand's persist middleware resolves `window.localStorage`, so the stub has
// to hang off a window object too -- otherwise every write logs a warning and
// the persistence behaviour under test is silently skipped.
globalThis.window = { localStorage: globalThis.localStorage } as unknown as Window & typeof globalThis;
