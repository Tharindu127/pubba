import { test } from "node:test";
import assert from "node:assert/strict";
import { createPubba } from "../src/index.ts";
import { examplePubba } from "./fixtures.ts";

const pubba = examplePubba();

test("match: typos, one word, aliases, places and roles", () => {
  const cases: [string, string, string][] = [
    ["flutr", "tech:Flutter", "phrase"],
    ["kiri walet", "project:kiri-wallet", "name"],
    ["sri lankan", "market:LK", "name"],
    ["UAE", "market:AE", "alias"],
    ["Lumen", "role:0", "distinct-word"],
    ["what did she build in Kenya?", "market:KE", "name"],
  ];
  for (const [q, id, by] of cases) {
    const m = pubba.match(q);
    assert.equal(m.intent, "entity", q);
    assert.equal(m.entity?.id, id, q);
    assert.equal(m.match?.reason.by, by, q);
  }
});

test("match: off-topic queries match nothing", () => {
  for (const q of ["what's the weather in Paris", "best pizza near me", "", "   ", "?!"]) {
    const m = pubba.match(q);
    assert.equal(m.intent, "none", q);
    assert.equal(m.entity, null);
  }
});

test("match: 'anything like X' returns X's similar items with reasons", () => {
  const m = pubba.match("anything like Kiri Wallet?");
  assert.equal(m.intent, "similar");
  assert.equal(m.entity?.id, "project:kiri-wallet");
  assert.deepEqual(m.similar.map((s) => s.entity.id), ["project:kiri-merchant"]);
  assert.deepEqual(m.similar[0]!.reason.via, ["Flutter", "Dart"]);
  // A type with no similar kinds configured uses any link.
  assert.equal(pubba.match("more like Skyforge Saga").similar[0]?.entity.id, "game:skyforge-saga-2");
});

test("match: 'like X' without similar items reads as the entity itself", () => {
  assert.equal(pubba.match("anything like Routewise").intent, "entity");
});

test("match: earlier tiers win; the owner's name never matches", () => {
  // "Kiri" could be the role's text, but projects are tier 1.
  assert.equal(pubba.match("kiri").entity?.id, "project:kiri-wallet");
  assert.equal(pubba.match("nimali").intent, "none");
  assert.deepEqual(pubba.search("nimali"), []);
  assert.equal(pubba.match("nimali youtube").entity?.id, "creative:youtube", "her channel is named by its platform");
});

test("notHere: a longer name the site doesn't have beats the shorter one inside it", () => {
  const p = examplePubba();
  p.graph.config.match = { ...p.graph.config.match, notHere: ["React Native Web", "Kotlin"] };
  assert.equal(p.match("react native web apps").intent, "none");
  assert.equal(p.match("react native web apps").notHere, "React Native Web");
  assert.equal(p.match("react native apps").entity?.id, "tech:React Native", "the longer real name still wins");
  assert.equal(p.match("does she know kotlin").notHere, "Kotlin");
  assert.equal(p.match("flutter").entity?.id, "tech:Flutter");
});

test("precise matching: spelled right wins, typo'd whole names count, coverage breaks ties, whole names beat earlier-tier fragments", () => {
  const loose = examplePubba({ pronoun: "she", owner: "Nimali", legacyMatching: true });
  assert.equal(pubba.match("Swift").entity?.id, "tech:Swift");
  assert.equal(pubba.match("skyfroge saga ii").entity?.id, "game:skyforge-saga-2");
  assert.equal(loose.match("skyfroge saga ii").entity?.id, "game:skyforge-saga");
  assert.equal(pubba.match("swfitui").entity?.id, "tech:SwiftUI");
});

test("search lists every candidate, best first, filterable by type", () => {
  const all = pubba.search("kiri");
  assert.deepEqual(all.map((m) => m.entity.id), ["project:kiri-wallet", "project:kiri-merchant"]);
  assert.deepEqual(pubba.search("react", { types: ["tech"] }).map((m) => m.entity.id), ["tech:React"]);
  // Phrase mode: the longer name wins when both fit.
  assert.deepEqual(pubba.search("react native apps", { types: ["tech"] }).map((m) => m.entity.id), ["tech:React Native", "tech:React"]);
});

test("match works with no config: one tier, title mode, every type", () => {
  const p = createPubba({
    entities: [
      { id: "course:intro-ml", type: "course", label: "Intro to Machine Learning", aliases: ["ML 101"] },
      { id: "topic:ml", type: "topic", label: "Machine learning" },
    ],
    links: [{ from: "course:intro-ml", kind: "about", to: "topic:ml" }],
  });
  assert.equal(p.match("ml 101").entity?.id, "course:intro-ml");
  assert.equal(p.match("machine lerning course").entity?.id, "topic:ml");
  assert.equal(p.match("gardening").intent, "none");
});
