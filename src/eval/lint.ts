import { isDestination } from "../graph.ts";
import type { Pubba } from "../index.ts";
import { normalize } from "../text.ts";
import type { Dataset, SharedRule } from "../types.ts";
import { nameOwners } from "./generate.ts";

/*
 * Content problems that cost accuracy, found before a visitor does: names that
 * collide, short names a typo away from common words, "core" weights on too
 * many things, dead ends. Run it whenever the content changes.
 */

export interface LintIssue {
  level: "error" | "warning" | "info";
  code: "duplicate-name" | "shared-first-word" | "short-name-typos" | "heavy-core" | "dead-end" | "dropped" | "no-url";
  message: string;
  ids: string[];
  fix?: string;
}

const list = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));

export function lint(pubba: Pubba, dataset?: Dataset): LintIssue[] {
  const g = pubba.graph;
  const issues: LintIssue[] = [];
  const label = (id: string) => g.entities.get(id)?.label ?? id;
  const stop = new Set(g.config.match?.stopWords ?? ["the", "app", "and", "for", "web", "application", "mobile", "portal", "site", "website"]);

  for (const [name, ids] of nameOwners(g)) {
    if (ids.size < 2) continue;
    const all = [...ids];
    issues.push({
      level: "error",
      code: "duplicate-name",
      message: `"${name}" names ${all.length} entities: ${list(all.map(label))}. A query for it can only find one.`,
      ids: all,
      fix: "Rename one, or remove the shared alias from the one it shouldn't mean.",
    });
  }

  // One-word queries by a shared first word only ever find the first entity.
  const byFirst = new Map<string, string[]>();
  for (const e of g.entities.values()) {
    const m = g.config.types?.[e.type]?.match;
    if (!m?.firstWord || m.skip) continue;
    const first = normalize(e.label).split(" ").find((w) => w.length > 2 && !stop.has(w));
    if (first && first.length > 3) byFirst.set(`${m.tier ?? 1}|${first}`, [...(byFirst.get(`${m.tier ?? 1}|${first}`) ?? []), e.id]);
  }
  for (const [k, ids] of byFirst) {
    if (ids.length < 2) continue;
    issues.push({
      level: "warning",
      code: "shared-first-word",
      message: `"${k.split("|")[1]}" starts ${list(ids.map(label))}: typed alone, it finds ${label(ids[0]!)}.`,
      ids,
      fix: "Fine if that's the one people mean. Otherwise add the word as an alias on the right one.",
    });
  }

  if ((g.config.match?.typoMinLength ?? 4) < 5) {
    const short = [...g.entities.values()].filter((e) => !g.config.types?.[e.type]?.match?.skip && /^[a-z]{4}$/.test(normalize(e.label)));
    if (short.length) {
      issues.push({
        level: "warning",
        code: "short-name-typos",
        message: `4-letter names accept a typo, so everyday words reach them ("hire" → Hive): ${list(short.map((e) => e.label))}.`,
        ids: short.map((e) => e.id),
        fix: "Set match.typoMinLength to 5.",
      });
    }
  }

  for (const r of (g.config.rules ?? []).concat(g.config.extraRules ?? []).filter((x): x is SharedRule => x.type === "shared")) {
    const targets = new Set<string>();
    for (const l of g.links) if (r.through.includes(l.kind) && g.entities.get(l.from)?.type === r.among) targets.add(l.to);
    const core = [...targets].filter((id) => (g.entities.get(id)?.weight ?? 1) >= (r.minWeight ?? 0));
    if (targets.size >= 20 && core.length / targets.size > 0.5) {
      issues.push({
        level: "warning",
        code: "heavy-core",
        message: `${core.length} of ${targets.size} things a ${r.among} links to through ${r.through.join("/")} count as core for "${r.kind}". Libraries and tools filed as core make unrelated items look alike: ${list(core.map(label).sort(), 20)}.`,
        ids: core,
        fix: "Give tools and libraries a lower weight (in the portfolio preset: a Tools or Platforms category, not Languages or Frameworks).",
      });
    }
  }

  const dead = [...g.entities.values()].filter((e) => isDestination(g, e) && pubba.next([e.id], { limit: 1 }).length === 0);
  if (dead.length) {
    issues.push({ level: "warning", code: "dead-end", message: `Nothing is suggested after ${list(dead.map((e) => e.label))}.`, ids: dead.map((e) => e.id), fix: "Link them to something a visitor can go to." });
  }

  if (dataset) {
    const dropped = dataset.entities.filter((e) => !g.entities.has(e.id));
    if (dropped.length) {
      issues.push({ level: "info", code: "dropped", message: `No links, so never suggested (queries still find them): ${list(dropped.map((e) => e.label))}.`, ids: dropped.map((e) => e.id) });
    }
  }

  const noUrl = [...g.entities.values()].filter((e) => isDestination(g, e) && !e.url);
  const typesWithUrls = new Set([...g.entities.values()].filter((e) => e.url).map((e) => e.type));
  const missing = noUrl.filter((e) => typesWithUrls.has(e.type));
  if (missing.length) {
    issues.push({ level: "info", code: "no-url", message: `No url, where others of their type have one: ${list(missing.map((e) => e.label))}.`, ids: missing.map((e) => e.id) });
  }
  return issues;
}

export function formatLint(issues: LintIssue[]): string {
  if (!issues.length) return "No issues.";
  const order = { error: 0, warning: 1, info: 2 };
  return [...issues]
    .sort((a, b) => order[a.level] - order[b.level])
    .map((i) => `${i.level.toUpperCase().padEnd(7)} ${i.code}: ${i.message}${i.fix ? `\n        Fix: ${i.fix}` : ""}`)
    .join("\n");
}
