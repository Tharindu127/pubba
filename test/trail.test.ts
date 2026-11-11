import { test } from "node:test";
import assert from "node:assert/strict";
import { createTrail, sectionStep, type TrailStorage } from "../src/index.ts";

const memory = (): TrailStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test("trail: records steps, skips repeats in a row, keeps the last max", () => {
  const t = createTrail({ max: 3 });
  for (const id of ["a", "a", "b", null, "c", "d", undefined]) t.record(id);
  assert.deepEqual(t.get(), ["b", "c", "d"]);
  t.record("b");
  assert.deepEqual(t.get(), ["c", "d", "b"]);
});

test("trail: saved to and restored from storage, tolerant of junk", () => {
  const s = memory();
  createTrail({ storage: s, key: "k" }).record("project:x");
  assert.deepEqual(createTrail({ storage: s, key: "k" }).get(), ["project:x"]);
  s.data.set("k", "not json");
  assert.deepEqual(createTrail({ storage: s, key: "k" }).get(), []);
  s.data.set("k", JSON.stringify(["a", 2, "b"]));
  assert.deepEqual(createTrail({ storage: s, key: "k" }).get(), ["a", "b"]);
});

test("trail: listeners hear changes and can unsubscribe; clear empties it", () => {
  const t = createTrail();
  let heard = 0;
  const off = t.subscribe(() => heard++);
  t.record("a");
  t.record("a");
  off();
  t.record("b");
  assert.equal(heard, 1);
  t.clear();
  assert.deepEqual(t.get(), []);
  assert.equal(sectionStep("games"), "section:games");
});

test("trail: storage that throws doesn't break it", () => {
  const t = createTrail({ storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } } });
  t.record("a");
  assert.deepEqual(t.get(), ["a"]);
});

test("VERSION matches package.json", async () => {
  const { VERSION } = await import("../src/index.ts");
  const { readFileSync } = await import("node:fs");
  assert.equal(VERSION, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});
