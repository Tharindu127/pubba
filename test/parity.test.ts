import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph as originalGraph, reason as originalReason, suggestNext as originalNext } from "./reference/original.ts";
import { examplePubba, portfolio } from "./fixtures.ts";
import type { PortfolioInput } from "../src/presets/portfolio.ts";

// The fictional portfolio, plus the edge cases the site's data has: a tool
// missing from the skills list, a project with no short name, a page named
// after its owner, a game sequel.
const extended: PortfolioInput = {
  ...portfolio,
  projects: [
    ...portfolio.projects,
    { slug: "the-app", title: "The App", subtitle: "An internal tool", description: "Built with Kotlin for the Lumen Labs team in Kenya.", category: "Mobile", technologies: ["Kotlin", "Firebase", "Jira"] },
    { slug: "kiri-cards", title: "Kiri Cards (beta)", subtitle: "Virtual cards", description: "Virtual payment cards, on top of Kiri Wallet.", category: "Mobile, Web", tags: ["founded", "fintech"], technologies: ["Flutter", "Dart", "Node.js", "TypeScript"] },
  ],
  creative: [...(portfolio.creative ?? []), { id: "nimali-ig", title: "Nimali on Instagram", platform: "Instagram", kind: "page", description: "Photos from trips." }],
};

const edgeKey = (from: string, kind: string, to: string, weight: number, via?: string[]) => `${from} ${kind} ${to} ${weight.toFixed(9)} ${via?.join(",") ?? ""}`;

for (const [name, input] of [["fictional portfolio", portfolio], ["with edge cases", extended]] as const) {
  test(`parity (${name}): the same entities and links as the original engine`, () => {
    const ref = originalGraph(input);
    const lib = examplePubba({ pronoun: "he", owner: input.person.short! }, input).graph;
    assert.deepEqual(
      [...lib.entities.values()].map((e) => `${e.id} ${e.type} ${e.label}`).sort(),
      [...ref.nodes.values()].map((n) => `${n.id} ${n.type} ${n.label}`).sort()
    );
    assert.deepEqual(lib.links.map((l) => edgeKey(l.from, l.kind, l.to, l.weight, l.via)).sort(), ref.edges.map((e) => edgeKey(e.from, e.verb, e.to, e.weight, e.via)).sort());
  });

  test(`parity (${name}): the same predictions and sentences as the original engine`, () => {
    const ref = originalGraph(input);
    const pubba = examplePubba({ pronoun: "he", owner: input.person.short! }, input);
    const ids = [...ref.nodes.keys()];
    const trails = [
      ...ids.map((id) => [id]),
      ...ids.slice(0, 30).map((id, i) => [id, ids[(i * 7 + 3) % ids.length]!]),
      ...ids.slice(0, 15).map((id, i) => [ids[(i * 5 + 1) % ids.length]!, id, ids[(i * 11 + 2) % ids.length]!]),
      ...["projects", "skills", "reach", "experience", "games", "creative", "nope"].map((s) => [`section:${s}`]),
      ["section:projects", "project:kiri-wallet", "section:skills"],
    ];
    for (const trail of trails) {
      for (const limit of [3, 5]) {
        const want = originalNext(ref, trail, { limit });
        const got = pubba.next(trail, { limit });
        const label = `${trail.join(" > ")} (limit ${limit})`;
        assert.equal(got.length, want.length, label);
        got.forEach((g, i) => {
          const w = want[i]!;
          assert.ok(Math.abs(g.score - w.score) < 1e-9, `${label}: score ${g.entity.id} ${g.score} vs ${w.node.id} ${w.score}`);
          // Equal scores may come in either order; the set and sentences must match.
          if (g.entity.id !== w.node.id) assert.ok(want.some((x) => x.node.id === g.entity.id && Math.abs(x.score - g.score) < 1e-9), `${label}: ${g.entity.id} vs ${w.node.id}`);
          const twin = want.find((x) => x.node.id === g.entity.id)!;
          assert.equal(g.text, originalReason(twin, input.person.short!), label);
        });
      }
    }
  });
}
