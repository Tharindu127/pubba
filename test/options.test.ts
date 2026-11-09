import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, closeTo, createPubba, mergeConfig, type Dataset, type PubbaConfig } from "../src/index.ts";
import { evaluate } from "../src/eval/index.ts";

const games: Dataset = {
  entities: [
    { id: "game:gow", type: "game", label: "God of War" },
    { id: "game:gowr", type: "game", label: "God of War Ragnarök" },
    { id: "game:rdr2", type: "game", label: "Red Dead Redemption 2" },
    { id: "tech:hive", type: "tech", label: "Hive" },
    { id: "project:repo-android", type: "project", label: "Student rePo (Android)", text: "Built alongside rePo for the web." },
    { id: "project:repo-web", type: "project", label: "Student rePo (Web)", mentionAs: ["rePo"] },
    { id: "area:ps5", type: "area", label: "PS5" },
  ],
  links: [
    { from: "game:gow", kind: "runs-on", to: "area:ps5" },
    { from: "game:gowr", kind: "runs-on", to: "area:ps5" },
    { from: "game:rdr2", kind: "runs-on", to: "area:ps5" },
    { from: "tech:hive", kind: "runs-on", to: "area:ps5" },
    { from: "project:repo-web", kind: "runs-on", to: "area:ps5" },
  ],
};
const base: PubbaConfig = {
  types: { tech: { match: { tier: 2, mode: "phrase" } }, area: { destination: false, match: { skip: true } } },
  rules: [{ type: "named-in", kind: "mentions", named: ["project"] }],
};
const strict = mergeConfig(base, { match: { typoMinLength: 5, distinctWords: true, partialWords: true } });

test("closeTo: typoMinLength keeps short words exact", () => {
  assert.ok(closeTo("hire", "hive"));
  assert.ok(!closeTo("hire", "hive", 5));
  assert.ok(closeTo("hives", "hive", 5), "plurals still count");
  assert.ok(closeTo("flutr", "flutter", 5));
});

test("match options are off by default and each fixes its case when on", () => {
  const loose = createPubba(games, base);
  const tight = createPubba(games, strict);
  assert.equal(loose.match("how do I hire him").entity?.id, "tech:hive");
  assert.equal(tight.match("how do I hire him").intent, "none");
  assert.equal(loose.match("ragnarok").intent, "none");
  assert.equal(tight.match("ragnarok").entity?.id, "game:gowr");
  assert.equal(tight.match("ragnarok").match?.reason.by, "distinct-word");
  assert.equal(loose.match("red dead").intent, "none");
  assert.equal(tight.match("red dead").entity?.id, "game:rdr2");
  // "god" and "war" are shared by two names, so neither is distinct.
  assert.equal(tight.match("god of war").entity?.id, "game:gow");
});

test("label-prefix stems link editions; extraRules add up and can run before a named rule", () => {
  const editions = { type: "label-prefix", id: "editions", kind: "same-series", among: "project", stems: true } as const;
  const after = buildGraph(games, mergeConfig(base, { extraRules: [editions] }));
  const before = buildGraph(games, mergeConfig(base, { extraRules: [{ ...editions, before: "mentions" }] }));
  const kindOf = (g: ReturnType<typeof buildGraph>) => g.links.find((l) => l.from === "project:repo-android" && l.to === "project:repo-web")?.kind;
  assert.equal(kindOf(after), "mentions", "the earlier rule wins the pair");
  assert.equal(kindOf(before), "same-series");
  const merged = mergeConfig({ extraRules: [editions] }, { extraRules: [{ ...editions, id: "b" }] });
  assert.equal(merged.extraRules?.length, 2);
});

test("eval: expectAny passes on any one, and counts as one part", () => {
  const p = createPubba(games, strict);
  const r = evaluate(p, { trails: [{ trail: ["game:gow"], expect: ["game:gowr"], expectAny: ["game:rdr2", "project:nope"] }] });
  assert.equal(r.suggestions.score, 1);
  const miss = evaluate(p, { trails: [{ trail: ["game:gow"], expectAny: ["project:nope"] }] });
  assert.equal(miss.suggestions.score, 0);
  assert.deepEqual(miss.suggestions.failures[0]!.missing, ["any of project:nope"]);
});
