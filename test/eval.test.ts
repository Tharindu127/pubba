import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, formatReport, regressions, type QueryCase, type TrailCase } from "../src/eval/index.ts";
import { examplePubba } from "./fixtures.ts";

const read = <T,>(p: string): T => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const queries = read<QueryCase[]>("../eval/queries.json");
const trails = read<TrailCase[]>("../eval/trails.json");
const baseline = read<{ matching: number; suggestions: number }>("../eval/baseline.json");

test("stricter default matching finds the article without the alias", () => {
  const pubba = examplePubba();
  pubba.get("creative:offline-first")!.aliases = [];
  assert.equal(pubba.match("field notes").entity?.id, "creative:offline-first");
});

test("the example dataset meets its eval baseline", () => {
  const report = evaluate(examplePubba(), { queries, trails });
  assert.deepEqual(regressions(report, baseline), [], formatReport(report));
});

test("the sample set covers every case the harness promises", () => {
  const tags = new Set(queries.flatMap((q) => q.tags ?? []));
  for (const t of ["typo", "one-word", "similar", "place", "role", "off-topic"]) assert.ok(tags.has(t), t);
});

test("a broken alias shows up as a failure and a regression", () => {
  // The site's original matching, where "notes" is a near miss of the alias "node".
  const pubba = examplePubba({ pronoun: "she", owner: "Nimali", legacyMatching: true });
  pubba.get("creative:offline-first")!.aliases = [];
  const report = evaluate(pubba, { queries, trails });
  assert.deepEqual(report.matching.failures.map((f) => f.case.query), ["field notes"]);
  assert.equal(regressions(report, baseline).length, 1);
  assert.match(formatReport(report), /"field notes": expected creative:offline-first, got tech:Node.js/);
});

test("scores: partial trail credit, and tolerance", () => {
  const report = evaluate(examplePubba(), { trails: [{ trail: ["project:kiri-wallet"], expect: ["project:kiri-merchant", "game:pixel-rally"] }] });
  assert.equal(report.suggestions.score, 0.5);
  assert.equal(report.suggestions.hitRate, 1);
  assert.deepEqual(regressions(report, { matching: 1, suggestions: 0.6 }, 0.1), []);
});
