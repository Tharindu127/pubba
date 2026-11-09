import { test } from "node:test";
import assert from "node:assert/strict";
import { createPubba, mergeConfig, renderReason } from "../src/index.ts";
import { portfolioConfig, fromPortfolio, portfolioTemplates } from "../src/presets/portfolio.ts";
import { examplePubba, portfolio } from "./fixtures.ts";

const pubba = examplePubba();
const wallet = pubba.get("project:kiri-wallet")!;
const role = pubba.get("role:0")!;

test("templates: direction picks out/in, type cases, [optional] parts", () => {
  assert.equal(pubba.explain({ kind: "built-with", to: "tech:Flutter", direction: "out" }, wallet), "Kiri Wallet is built with Flutter.");
  assert.equal(pubba.explain({ kind: "built-with", to: "project:kiri-wallet", direction: "in" }, "tech:Flutter"), "Flutter is part of Kiri Wallet's stack.");
  assert.equal(pubba.explain({ kind: "made-at", to: "project:kiri-wallet", direction: "in" }, role), "As Senior Mobile Engineer, she built Kiri Wallet.");
  assert.equal(pubba.explain({ kind: "same-stack", to: "project:kiri-merchant" }, wallet), "Kiri Wallet is built on the same stack as Kiri Merchant.");
  assert.equal(pubba.explain({ kind: "same-stack", to: "project:kiri-merchant", via: ["A", "B", "C", "D"] }, wallet), "Kiri Wallet is built on the same stack as Kiri Merchant (A, B, C).");
  assert.equal(pubba.explain({ kind: "mentions", to: "market:KE", direction: "out" }, role), "As Senior Mobile Engineer, she shipped to Kenya.");
  assert.equal(pubba.explain({ kind: "about", to: "topic:fintech", direction: "out" }, wallet), "Kiri Wallet is about fintech too.");
});

test("templates: overridable per call, per site, and as functions", () => {
  const fr = { "built-with": { out: "{item} est construit avec {other}." } };
  assert.equal(pubba.explain({ kind: "built-with", to: "tech:Flutter", direction: "out" }, wallet, fr), "Kiri Wallet est construit avec Flutter.");
  const site = createPubba(fromPortfolio(portfolio), mergeConfig(portfolioConfig(), { templates: { "shipped-in": (ctx) => `${ctx.itemLabel} → ${ctx.otherLabel}` } }));
  assert.equal(site.explain({ kind: "shipped-in", to: "market:KE", direction: "out" }, "project:kiri-wallet"), "Kiri Wallet → Kenya");
});

test("templates: an unknown kind still reads, from the kind label", () => {
  const p = createPubba(
    { entities: [{ id: "a", type: "page", label: "Install" }, { id: "b", type: "page", label: "Configure" }], links: [{ from: "a", kind: "see-also", to: "b" }] },
    { kinds: { "see-also": { label: "see also" } } }
  );
  // The link reads from its own "from" end, whichever end is suggested.
  assert.equal(p.related("a")[0]!.text, "Install: see also Configure.");
  assert.equal(p.related("b")[0]!.text, "Install: see also Configure.");
  assert.equal(renderReason(p.graph, { kind: "section" }, p.get("a")!), "Install is worth a look.");
});

test("pronouns: he, she and they", () => {
  assert.equal(portfolioTemplates("he")["worked-as"], "{item} is one of his roles.");
  assert.equal(portfolioTemplates("they")["section.game"], "{item} is one they play.");
  assert.equal(examplePubba({ pronoun: "they" }).explain({ kind: "founded", to: "me", direction: "in" }, "project:synthpad"), "Synthpad is one of their own ventures.");
});

test("every link kind in the example has a sentence, with no unfilled tokens", () => {
  for (const id of pubba.graph.entities.keys()) {
    for (const r of pubba.related(id, { destinationsOnly: false })) {
      assert.ok(!/[{}[\]]/.test(r.text) && r.text.endsWith("."), `${id}: ${r.text}`);
    }
  }
});
