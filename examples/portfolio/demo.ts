import { readFileSync } from "node:fs";
import { createPubba, createTrail } from "../../src/index.ts";
import { fromPortfolio, portfolioConfig, type PortfolioInput } from "../../src/presets/portfolio.ts";

// In an app: import { createPubba, createTrail } from "pubba";
//            import { fromPortfolio, portfolioConfig } from "pubba/portfolio";

const content: PortfolioInput = JSON.parse(readFileSync(new URL("./portfolio.json", import.meta.url), "utf8"));
const pubba = createPubba(fromPortfolio(content), portfolioConfig({ pronoun: "she", owner: "Nimali" }));
const { entities, links } = pubba.graph;
console.log(`Nimali's portfolio: ${entities.size} entities, ${links.length} links (${links.filter((l) => l.rule).length} derived).\n`);

console.log("Related to Kiri Wallet:");
for (const r of pubba.related("project:kiri-wallet", { limit: 4 })) console.log(`  ${(r.entity.short ?? r.entity.label).padEnd(24)} ${r.text}`);

const trail = createTrail();
for (const step of ["section:projects", "project:parcelo", "tech:TypeScript"]) trail.record(step);
console.log(`\nA visitor went ${trail.get().join(" → ")}. Next:`);
for (const s of pubba.next(trail.get())) console.log(`  ${(s.entity.short ?? s.entity.label).padEnd(24)} ${s.text}\n  ${"".padEnd(24)} ${JSON.stringify(s.reason)}`);

console.log("\nTyped questions:");
for (const q of ["flutr", "anything like Kiri Wallet?", "what did she build in Kenya?", "her time at Harbor Studio", "what's the weather in Paris?"]) {
  const m = pubba.match(q);
  const what = m.intent === "none" ? "nothing here (fall back)" : m.intent === "similar" ? `like ${m.entity!.label}: ${m.similar.map((s) => s.entity.label).join(", ")}` : `${m.entity!.label} (${m.match!.reason.by})`;
  console.log(`  ${JSON.stringify(q).padEnd(32)} ${what}`);
}

console.log(`\nType-ahead for "ty" after that trail: ${pubba.autocomplete("ty", trail.get()).map((s) => s.entity.label).join(", ")}`);
