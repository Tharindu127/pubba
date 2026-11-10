import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvents, summarise, type PubbaEvent } from "../src/index.ts";
import { evaluate, generateCases } from "../src/eval/index.ts";
import { fromPortfolio, portfolioConfig } from "../src/presets/portfolio.ts";
import { createPubba } from "../src/index.ts";
import { examplePubba, portfolio } from "./fixtures.ts";

const withEvents = (goals?: string[]) => {
  const events = createEvents(goals ? { goals } : {});
  const log: PubbaEvent[] = [];
  events.on((e) => log.push(e));
  const pubba = createPubba(fromPortfolio(portfolio), portfolioConfig({ pronoun: "she", owner: "Nimali" }), { events });
  return { pubba, log, events };
};

test("events: pubba emits what it suggests and what queries resolve to", () => {
  const { pubba, log } = withEvents();
  pubba.next(["project:kiri-wallet"]);
  pubba.related("project:kiri-wallet", { limit: 2 });
  pubba.match("anything like Kiri Wallet?");
  pubba.match("best pizza near me");
  pubba.autocomplete("ki");
  assert.deepEqual(log.map((e) => e.type), ["suggested", "suggested", "matched", "matched"], "autocomplete stays silent");
  const [next, rel, similar, none] = log as [any, any, any, any];
  assert.equal(next.source, "next");
  assert.ok(next.ids.includes("project:kiri-merchant") && next.reasonKinds.includes("same-stack"));
  assert.equal(rel.ids.length, 2);
  assert.deepEqual(similar, { type: "matched", intent: "similar", entityType: "project", by: "name" });
  assert.deepEqual(none, { type: "matched", intent: "none" });
});

test("events: nothing a visitor typed ever reaches an event", () => {
  const { pubba, log } = withEvents();
  const queries = ["my secret phone is 0771234567", "anything like Kiri Wallet?", "flutr", "email me at someone@example.com", "best pizza near me"];
  for (const q of queries) pubba.match(q);
  for (const q of queries) pubba.autocomplete(q);
  pubba.track.guidedTo("user typed this", "typed");
  pubba.track.reached("someone@example.com");
  const all = JSON.stringify(log);
  for (const q of queries) for (const word of q.split(" ").filter((w) => w.length > 3 && !/^(kiri|wallet|anything|like|flutr)$/i.test(w))) assert.ok(!all.toLowerCase().includes(word.toLowerCase()), `"${word}" leaked into ${all}`);
  for (const e of log) for (const [k, v] of Object.entries(e)) if (typeof v === "string") assert.ok(["type", "intent", "entityType", "by", "source", "to", "via", "goal"].includes(k), k);
});

test("track: checked ids, vias and goals; frozen events; unknown things dropped", () => {
  const { pubba, log } = withEvents(["contact", "book-call"]);
  pubba.track.guideOpened();
  assert.equal(pubba.track.guidedTo("project:sira-nope", "chip"), false);
  assert.equal(pubba.track.guidedTo("project:kiri-wallet", "chip"), true);
  assert.equal(pubba.track.guidedTo("project:kiri-wallet", "anything" as never), false);
  assert.equal(pubba.track.reached("resume"), false, "not a declared goal here");
  assert.equal(pubba.track.reached("book-call"), true);
  assert.deepEqual(log, [
    { type: "guide-opened" },
    { type: "guided-to", to: "project:kiri-wallet", entityType: "project", via: "chip" },
    { type: "reached", goal: "book-call" },
  ]);
  assert.ok(Object.isFrozen(log[1]));
});

test("track: unlinked entities count as places the guide can lead", () => {
  const extra = { ...portfolio, skills: [...portfolio.skills, { name: "Postman", category: "Tools" }] };
  const events = createEvents();
  const log: PubbaEvent[] = [];
  events.on((e) => log.push(e));
  const pubba = createPubba(fromPortfolio(extra), portfolioConfig(), { events });
  assert.equal(pubba.track.guidedTo("tech:Postman", "match"), true);
  assert.equal((log[0] as { entityType: string }).entityType, "tech");
});

test("events: a listener that throws never breaks the guide; unsubscribe works", () => {
  const events = createEvents();
  const seen: string[] = [];
  events.on(() => {
    throw new Error("analytics down");
  });
  const off = events.on((e) => seen.push(e.type));
  const pubba = createPubba(fromPortfolio(portfolio), portfolioConfig(), { events });
  assert.ok(pubba.next(["project:kiri-wallet"]).length > 0);
  off();
  pubba.track.guideOpened();
  assert.deepEqual(seen, ["suggested"]);
});

test("without events nothing changes: same answers, track is a no-op", () => {
  const plain = examplePubba();
  const { pubba } = withEvents();
  for (const t of [["project:kiri-wallet"], ["market:KE"], ["section:games"]]) assert.deepEqual(pubba.next(t), plain.next(t));
  assert.deepEqual(pubba.match("flutr"), plain.match("flutr"));
  assert.equal(plain.track.guidedTo("project:kiri-wallet", "chip"), false);
  assert.equal(plain.track.reached("contact"), false);
  const cases = generateCases(plain);
  assert.deepEqual(evaluate(pubba, cases).matching.score, evaluate(plain, cases).matching.score);
});

test("summarise: the funnel rows for one visit", () => {
  const events: PubbaEvent[] = [
    { type: "suggested", source: "next", ids: ["project:a"], reasonKinds: ["same-stack"] },
    { type: "reached", goal: "resume" },
    { type: "guide-opened" },
    { type: "guided-to", to: "project:a", entityType: "project", via: "chip" },
    { type: "guided-to", to: "project:a", entityType: "project", via: "suggestion" },
    { type: "guided-to", to: "tech:Flutter", entityType: "tech", via: "chip" },
    { type: "reached", goal: "contact" },
  ];
  assert.deepEqual(summarise(events), {
    usedGuide: true,
    guidedTo: ["project:a", "tech:Flutter"],
    guidedToTypes: ["project", "tech"],
    reached: ["resume", "contact"],
    guidedBeforeGoal: true,
  });
  assert.deepEqual(summarise([{ type: "suggested", source: "next", ids: [], reasonKinds: [] }, { type: "reached", goal: "contact" }]), {
    usedGuide: false,
    guidedTo: [],
    guidedToTypes: [],
    reached: ["contact"],
    guidedBeforeGoal: false,
  });
});
