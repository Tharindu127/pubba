import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEvents, loadBundle, pubbaFor, type PubbaEvent } from "../src/index.ts";

const bundle = (name: string) => JSON.parse(readFileSync(new URL(`../conformance/bundles/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;

test("without intents, every intent option gives the plain answer", () => {
  const pubba = loadBundle(bundle("courses"));
  const trail = [...pubba.graph.entities.keys()].slice(0, 3);
  const plain = pubba.next(trail, { intent: null });
  assert.deepEqual(pubba.next(trail), plain);
  assert.deepEqual(pubba.next(trail, { intent: "anything" }), plain);
  assert.deepEqual(pubba.intent(trail), { likely: null, confidence: 0, scores: { browsing: 1 }, evidence: [] });
});

test("a trail that leans one way reads as that intent; short or mixed ones stay browsing", () => {
  const pubba = loadBundle(bundle("catalogue"));
  const office = pubba.intent(["category:office", "product:oak-desk"]);
  assert.equal(office.likely, "home-office");
  assert.ok(office.confidence >= 0.4);
  const total = Object.values(office.scores).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.equal(pubba.intent([]).likely, null);
  // The catalogue also configures an intent named "browsing": reserved, so ignored.
  assert.deepEqual(Object.keys(office.scores), ["kids-room", "home-office", "browsing"]);
});

test("the boost is clamped to 0.5-2 and only marks suggestions it moved", () => {
  const pubba = loadBundle(bundle("catalogue"));
  const trail = ["category:office", "product:oak-desk"];
  const plain = pubba.next(trail, { limit: 5, intent: null });
  const leaning = pubba.next(trail, { limit: 5 });
  for (const s of leaning) {
    if (!s.reason.intent) continue;
    assert.ok(s.reason.intent.boost >= 0.5 && s.reason.intent.boost <= 2);
    assert.notEqual(plain.findIndex((p) => p.entity.id === s.entity.id), leaning.indexOf(s));
  }
  const chair = leaning.find((s) => s.entity.id === "product:oak-chair");
  if (chair?.reason.intent) assert.equal(chair.reason.intent.boost, 2);
});

test("suggested events say which intent was applied", () => {
  const events = createEvents();
  const seen: PubbaEvent[] = [];
  events.on((e) => seen.push(e));
  const pubba = pubbaFor(loadBundle(bundle("catalogue")).graph, { events });
  pubba.next(["category:office", "product:oak-desk"]);
  pubba.next(["category:office", "product:oak-desk"], { intent: null });
  assert.deepEqual(seen.map((e) => (e.type === "suggested" ? e.intent : "-")), ["home-office", undefined]);
});

test("eval reports intent accuracy and suggestions with and without intents", async () => {
  const { evaluate, formatReport } = await import("../src/eval/index.ts");
  const pubba = loadBundle(bundle("catalogue"));
  const report = evaluate(pubba, {
    trails: [
      { trail: ["category:office", "product:oak-desk"], expectAny: ["product:oak-chair"], intent: "home-office" },
      { trail: ["category:kids"], intent: "kids-room" },
      { trail: [], intent: null },
      { trail: ["product:linen-sofa"] },
    ],
  });
  assert.equal(report.intents?.total, 3);
  assert.equal(typeof report.suggestions.withoutIntents, "number");
  assert.match(formatReport(report), /Intents +\d/);
});

test("lint flags intents that can't be read and intents too alike to tell apart", async () => {
  const { lint } = await import("../src/eval/index.ts");
  const b = bundle("catalogue") as { config: Record<string, unknown> };
  b.config.intents = {
    ghost: { signals: { entities: { "product:nope": 1 } } },
    a: { signals: { entities: { "category:office": 1 }, types: { product: 0.5 } } },
    b: { signals: { entities: { "category:office": 1 }, types: { product: 0.4 } } },
  };
  const codes = lint(loadBundle(b)).map((i) => `${i.level}:${i.code}`);
  assert.ok(codes.includes("warning:intent-unknown-id"));
  assert.ok(codes.includes("warning:intent-overlap"));
});

test("the portfolio preset ships intents, off unless asked", async () => {
  const { portfolioConfig, PORTFOLIO_INTENTS } = await import("../src/presets/portfolio.ts");
  assert.equal(portfolioConfig().intents, undefined);
  assert.deepEqual(Object.keys(portfolioConfig({ intents: true }).intents ?? {}), Object.keys(PORTFOLIO_INTENTS));
});
