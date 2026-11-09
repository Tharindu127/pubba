import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCases } from "../src/eval/index.ts";
import { examplePubba, portfolio } from "./fixtures.ts";

const withExtras = {
  ...portfolio,
  skills: [...portfolio.skills, { name: "Postman", category: "Tools" }, { name: "Visual Studio Code", category: "Tools" }],
  markets: [...(portfolio.markets ?? []), { code: "QA", name: "Qatar" }],
};

test("unlinked entities: found by a query, never suggested", () => {
  const p = examplePubba(undefined, withExtras);
  assert.ok(!p.graph.entities.has("tech:Postman"));
  assert.ok(p.graph.unlinked.has("tech:Postman"));
  assert.equal(p.match("does she use Postman?").entity?.id, "tech:Postman");
  assert.equal(p.match("Visual Studio Code").entity?.id, "tech:Visual Studio Code");
  assert.equal(p.match("what did she build in Qatar").entity?.id, "market:QA");
  assert.deepEqual(p.related("tech:Postman"), []);
  assert.deepEqual(p.next(["tech:Postman"]), []);
  assert.ok(!p.autocomplete("post").some((s) => s.entity.id === "tech:Postman"));
  for (const id of [...p.graph.entities.keys()].slice(0, 20)) assert.ok(!p.next([id], { limit: 10 }).some((s) => s.entity.id === "tech:Postman" || s.entity.id === "market:QA"));
});

test("unlinked entities get generated name cases but no trails", () => {
  const { queries, trails } = generateCases(examplePubba(undefined, withExtras));
  assert.ok(queries.some((q) => q.expect === "tech:Postman"));
  assert.ok(!trails.some((t) => t.trail[0] === "tech:Postman"));
});

test("distinct words must be spelled right: a typo of one word is too little to go on", () => {
  const p = examplePubba();
  assert.equal(p.match("change the plan").intent, "none", "change is two edits from channel");
  assert.equal(p.match("her channel").entity?.id, "creative:youtube");
  assert.equal(p.match("her channels").entity?.id, "creative:youtube", "plurals still count");
});

test("generated trails from a hub accept anything tied with the third strongest", () => {
  const { trails } = generateCases(examplePubba());
  const figma = trails.find((t) => t.trail[0] === "tech:Figma")!;
  assert.deepEqual([...figma.expectAny!].sort(), ["project:ferrylink", "project:kiri-wallet"]);
  const firebase = trails.find((t) => t.trail[0] === "tech:Firebase")!;
  assert.ok(firebase.expectAny!.length > 3, "every project tied at Firebase's weight counts");
});
