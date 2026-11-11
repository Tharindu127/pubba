import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvents, createGuide, createPubba, createTrail, type Chip, type EntityChip, type PubbaEvent } from "../src/index.ts";

const ent = (c: Chip | undefined) => c as EntityChip;
import { fromPortfolio, portfolioConfig } from "../src/presets/portfolio.ts";
import { portfolio } from "./fixtures.ts";

const setup = (extra = {}) => {
  let clock = 0;
  const events = createEvents();
  const log: PubbaEvent[] = [];
  events.on((e) => log.push(e));
  const pubba = createPubba(fromPortfolio(portfolio), portfolioConfig({ pronoun: "she", owner: "Nimali" }), { events });
  const guide = createGuide(pubba, { now: () => clock, ...extra });
  return { guide, pubba, log, tick: (ms: number) => (clock += ms) };
};

test("ask: a named thing opens it, with what comes after it as chips", () => {
  const { guide } = setup();
  const r = guide.ask("kiri walet");
  assert.equal(r.kind, "open");
  assert.equal(r.text, "Here's Kiri Wallet.");
  assert.deepEqual(r.action, { type: "open", id: "project:kiri-wallet", url: "https://nimali.example.com/projects/kiri-wallet" });
  assert.equal(r.chips.length, 3);
  assert.equal(ent(r.chips[0]).id, "project:kiri-merchant");
  assert.ok(!r.chips.some((c) => ent(c).id === "project:kiri-wallet"));
  assert.equal(guide.trail.get().length, 0, "asking doesn't move the visitor");
});

test("ask: 'anything like X' opens the closest one and offers the rest", () => {
  const { guide } = setup();
  const r = guide.ask("projects similar to Tidepool");
  assert.equal(r.kind, "similar");
  assert.equal(r.action?.id, "project:parcelo");
  assert.match(r.text, /same stack as Tidepool Dashboard/);
  assert.deepEqual(r.chips.map((c) => ent(c).id), ["project:ferrylink"]);
});

test("ask: nothing here, a name the site doesn't have, and an empty question all answer, never fail", () => {
  const { guide, pubba } = setup();
  const none = guide.ask("best pizza near me");
  assert.equal(none.kind, "none");
  assert.equal(none.action, undefined);
  assert.equal(none.chips.length, 3, "a fresh visitor still gets places to start");
  pubba.graph.config.match = { ...pubba.graph.config.match, notHere: ["Kotlin"] };
  const notHere = guide.ask("does she know kotlin?");
  assert.equal(notHere.kind, "not-here");
  assert.equal(notHere.text, "Kotlin isn't here. These might help:");
  assert.equal(guide.ask("   ").kind, "start");
});

test("visited and follow record the trail; follow is measured, visited isn't", () => {
  const { guide, log } = setup();
  guide.opened();
  guide.visited("project:tidepool");
  guide.follow("project:parcelo", "chip");
  guide.visited("not:real");
  guide.follow("not:real", "chip");
  guide.reached("contact");
  assert.deepEqual(guide.trail.get(), ["project:tidepool", "project:parcelo"]);
  assert.deepEqual(log.filter((e) => e.type !== "suggested" && e.type !== "matched").map((e) => e.type), ["guide-opened", "guided-to", "reached"]);
  assert.ok(guide.chips().every((c) => ent(c).id !== "project:parcelo" && ent(c).id !== "project:tidepool"));
});

test("nudge: only after the visitor's own step, after the delay, once per item, a gap apart", () => {
  const { guide, tick } = setup();
  assert.equal(guide.nudge(), null, "no steps yet");
  guide.visited("project:kiri-wallet");
  tick(5000);
  assert.equal(guide.nudge(), null, "too soon");
  tick(4000);
  const n = guide.nudge()!;
  assert.equal(n.kind, "open");
  assert.match(n.text, /Want a look\?$/);
  assert.equal(n.chips.length, 1);
  assert.ok(ent(n.chips[0]).url, "something with a place of its own first");
  tick(100000);
  assert.equal(guide.nudge(), null, "once per item");
  guide.visited("market:KE");
  tick(9000);
  assert.ok(guide.nudge(), "a new item, after the gap");
  guide.follow("project:parcelo", "chip");
  tick(100000);
  assert.equal(guide.nudge(), null, "never after the guide's own trip");
  guide.visited("section:games");
  tick(100000);
  assert.equal(guide.nudge(), null, "never after just opening a section");
});

test("nudge: the gap holds across items", () => {
  const { guide, tick } = setup({ nudge: { gapMs: 60000 } });
  guide.visited("project:kiri-wallet");
  tick(9000);
  assert.ok(guide.nudge());
  guide.visited("project:tidepool");
  tick(9000);
  assert.equal(guide.nudge(), null);
  tick(60000);
  assert.ok(guide.nudge());
});

test("templates, routes and chip count are the site's to set", () => {
  const { guide } = setup({
    templates: { open: "Opening {item} for you!", none: "Hmm, not sure. Try:" },
    route: (e: { id: string }) => (e.id.startsWith("project:") ? `/work/${e.id.slice(8)}` : undefined),
    chips: 2,
  });
  const r = guide.ask("Tidepool");
  assert.equal(r.text, "Opening Tidepool Dashboard for you!");
  assert.equal(r.action?.url, "/work/tidepool");
  assert.equal(r.chips.length, 2);
  assert.equal(guide.ask("weather in paris").text, "Hmm, not sure. Try:");
});

test("a shared trail with storage keeps the visit across reloads", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const pubba = createPubba(fromPortfolio(portfolio), portfolioConfig());
  createGuide(pubba, { trail: createTrail({ storage }) }).visited("project:synthpad");
  assert.deepEqual(createGuide(pubba, { trail: createTrail({ storage }) }).trail.get(), ["project:synthpad"]);
});

test("0.3.1 accept: what a chip can't lead to is never suggested", () => {
  const extra = { ...portfolio, creative: [...(portfolio.creative ?? []), { id: "tiktok", title: "Nimali on TikTok", platform: "TikTok", kind: "channel" }] };
  const pubba = createPubba(fromPortfolio(extra), portfolioConfig({ pronoun: "she", owner: "Nimali" }));
  const chipable = (e: { type: string; label: string }) => e.type !== "creative" || !/nimali|page$|channel$/i.test(e.label);
  let clock = 0;
  const guide = createGuide(pubba, { accept: chipable, now: () => clock });
  const all = createGuide(pubba);
  guide.visited("project:kiri-wallet");
  all.visited("project:kiri-wallet");
  for (const trail of [["project:synthpad"], ["creative:night-synth"], ["section:creative"]]) {
    for (const id of trail) guide.visited(id);
    assert.ok(guide.chips(5).every((c) => chipable(pubba.get(ent(c).id) ?? { type: "", label: "" })), trail.join());
  }
  clock += 9000;
  const n = guide.nudge();
  assert.ok(!n || chipable(pubba.get(n.action!.id)!));
});

test("0.3.1 fallback: chips by context when the trail suggests nothing, strings become questions", () => {
  const pubba = createPubba({ entities: [{ id: "a", type: "page", label: "Alpha" }, { id: "b", type: "page", label: "Beta" }], links: [{ from: "a", kind: "x", to: "b" }] });
  const guide = createGuide(pubba, {
    fallback: (ctx) => (ctx.kind === "none" ? ["Show me everything", "How do I get in touch?"] : ctx.entity?.type === "page" ? ["More pages"] : undefined),
  });
  const none = guide.ask("weather");
  assert.deepEqual(none.chips, [{ label: "Show me everything", question: "Show me everything" }, { label: "How do I get in touch?", question: "How do I get in touch?" }]);
  guide.visited("a");
  guide.visited("b");
  assert.deepEqual(guide.ask("alpha").chips, [{ label: "More pages", question: "More pages" }], "after both pages nothing is left to predict");
  assert.ok(guide.ask("").chips.every((c) => "id" in c), "no fallback for start: the best-connected places");
});

test("0.3.1 wording: per-type templates with {label} and {line}, and {of} and {list} for similar", () => {
  const { guide } = setup({
    line: (e: { id: string }) => (e.id === "project:tidepool" ? "Analytics for marine researchers." : e.id === "game:pixel-rally" ? "Racing." : undefined),
    templates: {
      "open.project": "{label}: {line} Let me open it for you.",
      "open.game": "{label}: {line} Here it is in the game room.",
      "similar.project": "Built on the same stack as {of}: {list}.",
    },
  });
  assert.equal(guide.ask("tidepool").text, "Tidepool Dashboard: Analytics for marine researchers. Let me open it for you.");
  assert.equal(guide.ask("pixel rally").text, "Pixel Rally: Racing. Here it is in the game room.");
  assert.equal(guide.ask("kenya").text, "Here's Kenya.", "types without their own template use open");
  const similar = guide.ask("projects similar to Tidepool");
  assert.equal(similar.text, "Built on the same stack as Tidepool Dashboard: Parcelo Courier (TypeScript, Node.js), Ferrylink Booking (React, TypeScript).");
  assert.deepEqual(similar.similar?.map((c) => c.id), ["project:parcelo", "project:ferrylink"]);
});

test("0.3.1 nudge.prefer: the site's own preference, separate from route", () => {
  // Every entity has a route here, so the default can't tell a skill from a page; Pubba prefers anything but a skill.
  const route = () => "/somewhere";
  const plain = setup({ route });
  const pubbaLike = setup({ route, nudge: { prefer: (e: { type: string }) => e.type !== "tech" } });
  for (const { guide, tick } of [plain, pubbaLike]) {
    guide.visited("project:synthpad");
    tick(9000);
  }
  assert.equal(plain.guide.nudge()!.action!.id, "tech:TypeScript");
  assert.equal(pubbaLike.guide.nudge()!.action!.id, "creative:night-synth");
});
