function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {} as Storage;

  Object.defineProperties(storage, {
    length: {
      get: () => values.size,
    },
    clear: {
      value: () => values.clear(),
    },
    getItem: {
      value: (key: string) => values.get(String(key)) ?? null,
    },
    key: {
      value: (index: number) => Array.from(values.keys())[index] ?? null,
    },
    removeItem: {
      value: (key: string) => {
        values.delete(String(key));
      },
    },
    setItem: {
      value: (key: string, value: string) => {
        values.set(String(key), String(value));
      },
    },
  });

  return storage;
}

function hasUsableStorage(value: unknown): value is Storage {
  return Boolean(
    value &&
      typeof (value as Storage).clear === "function" &&
      typeof (value as Storage).getItem === "function" &&
      typeof (value as Storage).setItem === "function",
  );
}

let existingStorage: unknown;
try {
  existingStorage = globalThis.localStorage;
} catch {
  existingStorage = undefined;
}

if (!hasUsableStorage(existingStorage)) {
  const storage = createMemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
}
