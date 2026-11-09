/** Where a trail is kept between page loads: `sessionStorage` fits a visit. */
export interface TrailStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TrailOptions {
  /** Steps kept, oldest dropped first. Default 24. */
  max?: number;
  storage?: TrailStorage;
  key?: string;
}

export interface Trail {
  /** One step; the same step twice in a row counts once. */
  record(id: string | null | undefined): void;
  get(): string[];
  clear(): void;
  /** Called after every change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** A trail step for opening a section, which lights every entity of its type a little. */
export const sectionStep = (section: string): string => `section:${section}`;

/**
 * A visitor's trail through the site, in entity ids, most recent last.
 * Kept in memory, and in `storage` when one is given; never sent anywhere.
 */
export function createTrail({ max = 24, storage, key = "pubba-trail" }: TrailOptions = {}): Trail {
  let steps: string[] = [];
  let loaded = false;
  const listeners = new Set<() => void>();

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
      if (Array.isArray(saved)) steps = saved.filter((x): x is string => typeof x === "string").slice(-max);
    } catch {
      // A broken or missing save starts a fresh trail.
    }
  };
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(steps));
    } catch {
      // Storage full or blocked: the trail lives on in memory.
    }
    listeners.forEach((l) => l());
  };

  return {
    record(id) {
      if (!id) return;
      load();
      if (steps[steps.length - 1] === id) return;
      steps = [...steps, id].slice(-max);
      save();
    },
    get() {
      load();
      return steps;
    },
    clear() {
      loaded = true;
      steps = [];
      save();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
