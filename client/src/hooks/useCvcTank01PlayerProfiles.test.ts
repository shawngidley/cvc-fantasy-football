import { afterEach, describe, expect, it } from "vitest";
import { acquirePlayerInfoSlot, persistProfile, PROFILE_TTL_MS, profileKey, readPersistedProfile, releasePlayerInfoSlot } from "./useCvcTank01PlayerProfiles";

describe("CVC Tank01 player-info concurrency limiter (ported from WRC's confirmed fix)", () => {
  it("allows up to the concurrency limit (5) to acquire a slot immediately", async () => {
    const acquiredOrder: number[] = [];
    const acquisitions = [1, 2, 3, 4, 5].map(async i => {
      await acquirePlayerInfoSlot();
      acquiredOrder.push(i);
    });
    await Promise.all(acquisitions);
    // All 5 should have resolved without needing to wait on each other.
    expect(acquiredOrder.sort()).toEqual([1, 2, 3, 4, 5]);
    // Release all 5 to leave the module-level state clean for other tests.
    for (let i = 0; i < 5; i++) releasePlayerInfoSlot();
  });

  it("queues a 6th request until a slot is released", async () => {
    // Fill all 5 slots.
    for (let i = 0; i < 5; i++) await acquirePlayerInfoSlot();

    let sixthAcquired = false;
    const sixth = acquirePlayerInfoSlot().then(() => { sixthAcquired = true; });

    // Give any pending microtasks a chance to run -- the 6th should NOT
    // have acquired yet, since all 5 slots are still held.
    await Promise.resolve();
    await Promise.resolve();
    expect(sixthAcquired).toBe(false);

    // Release one slot -- the queued 6th should now be able to proceed.
    releasePlayerInfoSlot();
    await sixth;
    expect(sixthAcquired).toBe(true);

    // Clean up: release the remaining 4 original slots plus the 6th's slot.
    for (let i = 0; i < 5; i++) releasePlayerInfoSlot();
  });

  it("lets a 7th and 8th request queue behind the 6th, and releases them in FIFO order", async () => {
    for (let i = 0; i < 5; i++) await acquirePlayerInfoSlot();
    const resolvedOrder: number[] = [];
    const sixth = acquirePlayerInfoSlot().then(() => resolvedOrder.push(6));
    const seventh = acquirePlayerInfoSlot().then(() => resolvedOrder.push(7));

    releasePlayerInfoSlot();
    await sixth;
    releasePlayerInfoSlot();
    await seventh;

    expect(resolvedOrder).toEqual([6, 7]);
    for (let i = 0; i < 5; i++) releasePlayerInfoSlot();
  });
});

describe("profileKey", () => {
  it("normalizes a display name to a stable cache key", () => {
    expect(profileKey("James Cook III")).toBe("jamescookiii");
    expect(profileKey("  Ja'Marr Chase ")).toBe("jamarrchase");
  });
});

describe("localStorage-backed profile cache (persists across reloads/tabs, unlike the previous in-memory-only cache)", () => {
  const originalLocalStorage = globalThis.localStorage;

  function installMockLocalStorage(): Storage {
    const store = new Map<string, string>();
    const mock: Storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() { return store.size; },
    };
    Object.defineProperty(globalThis, "localStorage", { value: mock, configurable: true, writable: true });
    return mock;
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage, configurable: true, writable: true });
  });

  it("round-trips a profile through persistProfile/readPersistedProfile", () => {
    installMockLocalStorage();
    const entry = { value: { espnHeadshot: "https://example.com/x.png" }, expiresAt: Date.now() + PROFILE_TTL_MS };
    persistProfile("jaxdst", entry);
    expect(readPersistedProfile("jaxdst")).toEqual(entry);
  });

  it("uses a TTL of many hours (24h), not the old cache's short-lived scale", () => {
    expect(PROFILE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(PROFILE_TTL_MS).toBeGreaterThan(60 * 60 * 1000); // well over an hour
  });

  it("treats an expired entry as a miss", () => {
    installMockLocalStorage();
    persistProfile("stale", { value: { age: "27" }, expiresAt: Date.now() - 1000 });
    expect(readPersistedProfile("stale")).toBeNull();
  });

  it("returns null for a key that was never persisted", () => {
    installMockLocalStorage();
    expect(readPersistedProfile("never-seen")).toBeNull();
  });

  it("degrades gracefully (no throw) when localStorage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true, writable: true });
    expect(() => persistProfile("x", { value: null, expiresAt: Date.now() + 1000 })).not.toThrow();
    expect(readPersistedProfile("x")).toBeNull();
  });
});
