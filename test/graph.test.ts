import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, neighbours, type Dataset, type PubbaConfig } from "../src/index.ts";

const catalogue: Dataset = {
  entities: [
    { id: "product:desk", type: "product", label: "Oak Desk", text: "A solid oak desk, pairs with the Oak Chair." },
    { id: "product:chair", type: "product", label: "Oak Chair", text: "Solid oak, linen seat." },
    { id: "product:lamp", type: "product", label: "Brass Lamp", text: "Brass and linen." },
    { id: "product:shelf", type: "product", label: "Oak Shelf" },
    { id: "material:oak", type: "material", label: "Oak", weight: 1 },
    { id: "material:linen", type: "material", label: "Linen", weight: 1 },
    { id: "material:brass", type: "material", label: "Brass", weight: 1 },
    { id: "material:glue", type: "material", label: "Glue", weight: 0.2 },
    { id: "brand:north", type: "brand", label: "North & Co" },
    { id: "lonely", type: "product", label: "Nothing links here" },
  ],
  links: [
    { from: "product:desk", kind: "made-of", to: "material:oak" },
    { from: "product:desk", kind: "made-of", to: "material:linen" },
    { from: "product:desk", kind: "made-of", to: "material:glue" },
    { from: "product:chair", kind: "made-of", to: "material:oak" },
    { from: "product:chair", kind: "made-of", to: "material:linen" },
    { from: "product:chair", kind: "made-of", to: "material:glue" },
    { from: "product:lamp", kind: "made-of", to: "material:brass" },
    { from: "product:lamp", kind: "made-of", to: "material:linen" },
    { from: "product:shelf", kind: "made-of", to: "material:oak" },
    { from: "product:desk", kind: "by", to: "brand:north", weight: 0.9 },
    { from: "brand:north", kind: "by", to: "product:desk" },
  ],
};

const config: PubbaConfig = {
  kinds: { "made-of": { weightFrom: "to", weight: 0.5 }, "goes-with": { pull: 1 } },
  rules: [
    { type: "shared", kind: "goes-with", among: "product", through: ["made-of"], minWeight: 1, min: 2 },
    { type: "co-occur", kind: "paired", among: "material", through: ["made-of"], minWeight: 0.5, min: 2 },
    { type: "named-in", kind: "mentions", named: ["product"], weight: 0.5 },
    { type: "topics", kind: "about", topics: [{ key: "natural", label: "Natural materials", pattern: "\\b(oak|linen)\\b" }], weight: 0.7 },
  ],
};

test("explicit links take weights from the link, then the end entity, then the kind", () => {
  const g = buildGraph(catalogue, config);
  const w = (from: string, to: string) => g.links.find((l) => l.from === from && l.to === to)?.weight;
  assert.equal(w("product:desk", "brand:north"), 0.9);
  assert.equal(w("product:desk", "material:oak"), 1);
  assert.equal(w("product:desk", "material:glue"), 0.2);
});

test("one link per pair: the first wins, reversed duplicates included", () => {
  const g = buildGraph(catalogue, config);
  assert.equal(g.links.filter((l) => [l.from, l.to].sort().join() === ["brand:north", "product:desk"].sort().join()).length, 1);
  // Desk and chair share oak and linen: goes-with, not the later "mentions" from the desk's text.
  const pair = g.links.filter((l) => [l.from, l.to].sort().join() === "product:chair,product:desk");
  assert.equal(pair.length, 1);
  assert.equal(pair[0]!.kind, "goes-with");
});

test("shared rule: weight from shared over union, via the shared labels, light targets ignored", () => {
  const g = buildGraph(catalogue, config);
  const l = g.links.find((x) => x.kind === "goes-with")!;
  assert.deepEqual(l.via, ["Oak", "Linen"]);
  assert.equal(l.weight, 1);
  assert.equal(l.rule, "goes-with");
  assert.ok(!g.links.some((x) => x.kind === "goes-with" && x.to === "product:lamp"));
});

test("co-occur rule links targets used together twice or more", () => {
  const g = buildGraph(catalogue, config);
  const l = g.links.find((x) => x.kind === "paired")!;
  assert.deepEqual([l.from, l.to], ["material:linen", "material:oak"]);
  assert.deepEqual(l.via, ["Oak Desk", "Oak Chair"]);
  assert.equal(l.weight, 0.5);
});

test("topics rule creates topic entities from text", () => {
  const g = buildGraph(catalogue, config);
  assert.equal(g.entities.get("topic:natural")?.label, "Natural materials");
  assert.ok(g.links.some((l) => l.from === "product:lamp" && l.kind === "about"));
});

test("label-prefix rule finds a series", () => {
  const g = buildGraph(
    { entities: [{ id: "a", type: "book", label: "Dune" }, { id: "b", type: "book", label: "Dune Messiah" }, { id: "c", type: "book", label: "Dunes of Mars" }] },
    { rules: [{ type: "label-prefix", kind: "same-series", among: "book" }] }
  );
  assert.deepEqual(g.links.map((l) => `${l.from}>${l.to}`), ["a>b"]);
});

test("entities with no links are dropped, links to unknown ids ignored", () => {
  const g = buildGraph({ ...catalogue, links: [...catalogue.links!, { from: "product:desk", kind: "x", to: "ghost" }] }, config);
  assert.ok(!g.entities.has("lonely"));
  assert.ok(!g.links.some((l) => l.to === "ghost"));
});

test("neighbours: strongest first, filtered by kind", () => {
  const g = buildGraph(catalogue, config);
  const n = neighbours(g, "product:desk");
  assert.ok(n.every((x, i) => i === 0 || n[i - 1]!.link.weight >= x.link.weight));
  assert.deepEqual(neighbours(g, "product:desk", ["goes-with"]).map((x) => x.entity.id), ["product:chair"]);
});
