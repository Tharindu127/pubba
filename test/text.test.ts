import { test } from "node:test";
import assert from "node:assert/strict";
import { closeTo, editDistance, hasPhrase, mentions, normalize } from "../src/index.ts";

test("normalize folds case, accents and punctuation but keeps C#, C++ and Next.js", () => {
  assert.equal(normalize("  Café — Next.js & C#!  "), "cafe next.js c#");
  assert.equal(normalize("C++/Rust"), "c++ rust");
});

test("editDistance counts a swap of neighbours once", () => {
  assert.equal(editDistance("moblie", "mobile"), 1);
  assert.equal(editDistance("flutter", "flutter"), 0);
  assert.equal(editDistance("kitten", "sitting"), 3);
});

test("closeTo: exact, plural, prefix and near misses; short and symbol names exactly", () => {
  assert.ok(closeTo("flutter", "flutter"));
  assert.ok(closeTo("apps", "app"));
  assert.ok(closeTo("lankan", "lanka"));
  assert.ok(closeTo("flutr", "flutter"));
  assert.ok(closeTo("typscript", "typescript"));
  assert.ok(!closeTo("ga", "go"));
  assert.ok(!closeTo("c", "c#"));
  assert.ok(!closeTo("nextjs", "next.js"));
  assert.ok(!closeTo("pizza", "python"));
  assert.ok(closeTo("weather", "whether"), "long words allow two edits");
  assert.ok(!closeTo(undefined, "x"));
});

test("hasPhrase finds a phrase word by word, typos allowed", () => {
  assert.ok(hasPhrase("does she know reactt native", "react native"));
  assert.ok(!hasPhrase("native react", "react native"));
  assert.ok(hasPhrase("is there an api", "go", "api"));
});

test("mentions needs whole words", () => {
  assert.ok(mentions("Built in Flutter, mostly.", "flutter"));
  assert.ok(!mentions("Fluttering about", "flutter"));
  assert.ok(mentions("Uses C# daily", "C#"));
});
