import { test } from "node:test";
import assert from "node:assert/strict";
import { examplePubba } from "./fixtures.ts";

const pubba = examplePubba();

test("next: unseen destinations only, best first, each with a structured reason and a sentence", () => {
  const out = pubba.next(["project:kiri-wallet"]);
  assert.equal(out.length, 3);
  assert.ok(out.every((s, i) => i === 0 || out[i - 1]!.score >= s.score));
  assert.ok(!out.some((s) => s.entity.id === "project:kiri-wallet"));
  assert.ok(!out.some((s) => ["area", "topic", "person"].includes(s.entity.type)));
  assert.deepEqual(out[0]!.reason, { kind: "same-stack", to: "project:kiri-wallet", direction: "in", via: ["Flutter", "Dart"] });
  assert.equal(out[0]!.text, "Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).");
});

test("next: never all of one type when there is a choice", () => {
  for (const trail of [["tech:React"], ["market:KE"], ["project:tidepool", "project:ferrylink"]]) {
    const types = new Set(pubba.next(trail).map((s) => s.entity.type));
    assert.ok(types.size > 1, trail.join(" > "));
  }
});

test("next: a two-step suggestion names the trail step it came from", () => {
  const out = pubba.next(["tech:Flutter"], { limit: 8 });
  const far = out.find((s) => s.reason.seed);
  assert.ok(far, "some suggestion came two steps away");
  assert.equal(far!.reason.seed, "tech:Flutter");
});

test("next: sections light their type; exclude and accept filter", () => {
  const games = pubba.next(["section:games"]);
  assert.ok(games.every((s) => s.entity.type === "game"));
  assert.equal(games[0]!.reason.kind, "section");
  assert.equal(games[0]!.text, "Skyforge Saga is one she plays.");
  const out = pubba.next(["project:kiri-wallet"], { exclude: ["project:kiri-merchant"], accept: (e) => e.type !== "role" });
  assert.ok(!out.some((s) => s.entity.id === "project:kiri-merchant" || s.entity.type === "role"));
  assert.deepEqual(pubba.next([]), []);
  assert.deepEqual(pubba.next(["no:such-id"]), []);
});

test("related: strongest first, equal weights by pull, with reasons", () => {
  const out = pubba.related("project:kiri-wallet");
  assert.ok(out.every((r, i) => i === 0 || out[i - 1]!.weight >= r.weight));
  assert.equal(out[0]!.entity.id, "project:kiri-merchant");
  assert.ok(out.every((r) => r.reason.to === "project:kiri-wallet" && r.text.length > 0));
  assert.deepEqual(pubba.related("project:kiri-wallet", { kinds: ["shipped-in"] }).map((r) => r.entity.id), ["market:KE", "market:GH"]);
  assert.ok(!pubba.related("project:kiri-wallet").some((r) => r.entity.type === "topic"));
  assert.ok(pubba.related("project:kiri-wallet", { destinationsOnly: false }).some((r) => r.entity.type === "topic"));
});

test("autocomplete: prefix first, nearest the trail breaks ties, needs two letters", () => {
  assert.deepEqual(pubba.autocomplete("k"), []);
  const out = pubba.autocomplete("ki");
  assert.deepEqual(out.map((s) => s.entity.id).sort(), ["project:kiri-merchant", "project:kiri-wallet"]);
  assert.equal(out[0]!.reason.kind, "typed");
  assert.equal(out[0]!.reason.by, "prefix");
  // Near the merchant side of things, the merchant app comes first.
  assert.equal(pubba.autocomplete("kiri", ["role:0", "project:kiri-wallet"])[0]!.entity.id, "project:kiri-merchant");
  assert.equal(pubba.autocomplete("pool")[0]!.reason.by, "contains");
  assert.equal(pubba.autocomplete("dash")[0]!.reason.by, "word-prefix");
});
