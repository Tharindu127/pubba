import { allEntities, isDestination, neighbours } from "../graph.ts";
import type { Pubba } from "../index.ts";
import { normalize } from "../text.ts";
import type { Entity, Graph } from "../types.ts";
import type { QueryCase, TrailCase } from "./index.ts";

/*
 * Eval cases derived from the graph, so the test set grows with the content:
 * every entity a visitor can be sent to gets its name, a typo of it, each
 * alias and "anything like it" as queries, and a trail from it that must lead
 * to its closest relation. Hand-written cases still cover what generation
 * can't know: off-topic questions and how visitors really phrase things.
 */

export interface GenerateOptions {
  /** Only these types. Default: every destination type that is matched. */
  types?: string[];
  typos?: boolean;
  aliases?: boolean;
  similar?: boolean;
  trails?: boolean;
}

const matchable = (g: Graph, e: Entity) => isDestination(g, e) && !g.config.types?.[e.type]?.match?.skip;

/** Every normalised name, with the entities that carry it. */
export function nameOwners(g: Graph): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const e of allEntities(g)) {
    if (g.config.types?.[e.type]?.match?.skip) continue;
    for (const raw of [e.label, ...(e.aliases ?? [])]) {
      const n = normalize(raw);
      if (n) owners.set(n, (owners.get(n) ?? new Set()).add(e.id));
    }
  }
  return owners;
}

/** One swap of neighbouring letters inside a word: a typo every matcher setting forgives. */
function typoOf(name: string, minLength: number): string | null {
  const words = name.split(" ");
  const i = words.reduce((best, w, j) => (/^[a-z]+$/.test(w) && w.length > (words[best]?.length ?? 0) ? j : best), -1);
  const w = i >= 0 ? words[i]! : "";
  if (w.length < Math.max(6, minLength + 1)) return null;
  const k = Math.floor(w.length / 2);
  if (w[k] === w[k + 1]) return null;
  words[i] = `${w.slice(0, k)}${w[k + 1]}${w[k]}${w.slice(k + 2)}`;
  return words.join(" ");
}

export function generateCases(pubba: Pubba, o: GenerateOptions = {}): { queries: QueryCase[]; trails: TrailCase[] } {
  const g = pubba.graph;
  const owners = nameOwners(g);
  const ignore = (g.config.match?.ignore ?? []).map(normalize).filter(Boolean);
  const typoMin = g.config.match?.typoMinLength ?? 4;
  const unique = (n: string) => (owners.get(n)?.size ?? 0) === 1;
  const queries: QueryCase[] = [];
  const trails: TrailCase[] = [];
  const pulls = Object.values(g.config.kinds ?? {}).map((k) => k.pull ?? 0.5);
  const topPull = pulls.length ? Math.max(...pulls) : 0.5;

  for (const e of allEntities(g)) {
    if (!matchable(g, e) || (o.types && !o.types.includes(e.type))) continue;
    const label = normalize(e.label);
    const ignored = (n: string) => ignore.some((w) => n.includes(w));
    if (label && unique(label) && !ignored(label)) {
      queries.push({ query: e.label, expect: e.id, tags: ["generated", "name", e.type] });
      const typo = o.typos === false ? null : typoOf(label, typoMin);
      if (typo && !owners.has(typo)) queries.push({ query: typo, expect: e.id, tags: ["generated", "typo", e.type] });
    }
    if (o.aliases !== false) {
      for (const a of e.aliases ?? []) {
        const n = normalize(a);
        if (n && n !== label && unique(n) && !ignored(n)) queries.push({ query: a, expect: e.id, tags: ["generated", "alias", e.type] });
      }
    }
    const kinds = g.config.types?.[e.type]?.similar;
    const alike = neighbours(g, e.id, kinds).filter((n) => isDestination(g, n.entity));
    if (o.similar !== false && kinds && alike.length && label && unique(label) && !ignored(label)) {
      queries.push({ query: `anything like ${e.label}?`, expect: e.id, intent: "similar", tags: ["generated", "similar", e.type] });
    }

    if (o.trails === false || !g.entities.has(e.id)) continue;
    // One of its three closest siblings (the kinds that pull hardest), else of its three strongest relations.
    const related = pubba.related(e.id);
    const siblings = related.filter((r) => (g.config.kinds?.[r.link.kind]?.pull ?? 0.5) >= topPull);
    // The three strongest, and anything tied with the third: among equals the order is arbitrary.
    const pool = siblings.length ? siblings : related;
    const third = pool[Math.min(2, pool.length - 1)]?.weight ?? 0;
    const best = pool.filter((r, i) => i < 3 || r.weight >= third);
    if (best.length) {
      trails.push({
        name: `${e.label} → ${siblings.length ? "a close sibling" : "a close relation"}`,
        trail: [e.id],
        expectAny: best.map((r) => r.entity.id),
      });
    }
  }
  return { queries, trails };
}
