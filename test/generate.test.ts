import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, generateCases, lint } from "../src/eval/index.ts";
import { fromPortfolio } from "../src/presets/portfolio.ts";
import { examplePubba, portfolio } from "./fixtures.ts";

const withProject = (p: (typeof portfolio.projects)[number]) => ({ ...portfolio, projects: [...portfolio.projects, p] });

test("generated cases cover every matchable destination, and all pass on the example", () => {
  const pubba = examplePubba();
  const { queries, trails } = generateCases(pubba);
  const tags = new Set(queries.flatMap((q) => q.tags ?? []));
  for (const t of ["generated", "name", "typo", "alias", "similar"]) assert.ok(tags.has(t), t);
  assert.ok(queries.some((q) => q.expect === "project:kiri-wallet" && q.tags?.includes("typo")));
  assert.ok(!queries.some((q) => q.expect?.startsWith("topic:") || q.expect?.startsWith("area:")), "only things a visitor can go to");
  const report = evaluate(pubba, { queries, trails });
  assert.equal(report.matching.score, 1, JSON.stringify(report.matching.failures));
  assert.equal(report.suggestions.score, 1, JSON.stringify(report.suggestions.failures));
});

test("the eval grows with the content", () => {
  const before = generateCases(examplePubba());
  const grown = examplePubba(undefined, withProject({ slug: "lantern", title: "Lantern Notes", subtitle: "Offline notes", description: "A notes app in Flutter, used in Kenya.", category: "Mobile", technologies: ["Flutter", "Dart"] }));
  const after = generateCases(grown);
  assert.ok(after.queries.length > before.queries.length);
  assert.ok(after.queries.some((q) => q.expect === "project:lantern"));
  assert.ok(after.trails.some((t) => t.trail[0] === "project:lantern"));
  assert.equal(evaluate(grown, after).matching.score, 1);
});

test("lint: a new project whose name collides is an error, and its eval case is skipped not faked", () => {
  const grown = examplePubba(undefined, withProject({ slug: "kiri-wallet-2", title: "Kiri Wallet", description: "Again.", category: "Mobile", technologies: ["Flutter"] }));
  const issues = lint(grown);
  assert.ok(issues.some((i) => i.level === "error" && i.code === "duplicate-name" && i.ids.includes("project:kiri-wallet-2")));
  assert.ok(!generateCases(grown).queries.some((q) => q.query === "Kiri Wallet"));
});

test("lint: shared first words, heavy core weights, dead ends, dropped entities", () => {
  const pubba = examplePubba();
  const codes = lint(pubba).map((i) => i.code);
  assert.deepEqual(codes, ["shared-first-word"], "the example is clean apart from Kiri Wallet / Kiri Merchant");

  const heavy = { ...portfolio, skills: portfolio.skills.map((s) => ({ ...s, category: "Languages" })), projects: portfolio.projects.map((p, i) => ({ ...p, technologies: [...p.technologies, ...Array.from({ length: 3 }, (_, j) => `Lib${i}-${j}`)] })) };
  heavy.skills.push(...heavy.projects.flatMap((p) => p.technologies.filter((t) => t.startsWith("Lib")).map((name) => ({ name, category: "Languages" }))));
  assert.ok(lint(examplePubba(undefined, heavy)).some((i) => i.code === "heavy-core"));

  const lonely = { ...portfolio, games: [...(portfolio.games ?? []), { id: "solo", title: "Solo Quest", platform: "Switch" }] };
  const p2 = examplePubba(undefined, lonely);
  assert.ok(lint(p2).some((i) => i.code === "dead-end" && i.ids.includes("game:solo")));
  const data = fromPortfolio({ ...portfolio, skills: [...portfolio.skills, { name: "Cobol", category: "Languages" }] });
  assert.ok(lint(examplePubba(), data).some((i) => i.code === "dropped" && i.ids.includes("tech:Cobol")));
});

test("lint: legacy matching warns about 4-letter names", () => {
  const legacy = examplePubba({ pronoun: "she", owner: "Nimali", legacyMatching: true });
  assert.ok(lint(legacy).some((i) => i.code === "short-name-typos" && i.ids.includes("tech:Dart")));
});
