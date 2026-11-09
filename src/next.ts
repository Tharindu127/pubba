import { degree, isDestination, neighbours, otherEnd } from "./graph.ts";
import { normalize } from "./text.ts";
import { reasonFromLink, renderReason } from "./reasons.ts";
import type { Entity, Graph, GraphLink, Reason, Related, Suggestion, Template } from "./types.ts";

/*
 * "What next?" by spreading activation, the way a search engine follows
 * Eiffel Tower to Paris: whatever the visitor is on, and has been on, lights
 * up; the light spreads along the links (two steps at most, weaker with each
 * step and through busy hubs); the brightest things they haven't seen are
 * the suggestions, each with the link that led there.
 *
 * A trail holds entity ids, most recent last, and may hold sections
 * ("section:games"), which light every entity of that section's type a little.
 */

const pullOf = (g: Graph, kind: string) => g.config.kinds?.[kind]?.pull ?? 0.5;

interface Spread {
  score: Map<string, number>;
  why: Map<string, { link: GraphLink; from: string; seed: string; part: number }>;
  seeds: Map<string, number>;
  sectionOnly: Set<string>;
}

/** How brightly each entity lights up for this trail, with the strongest reason for each. */
export function spread(g: Graph, trail: string[]): Spread {
  const cfg = g.config.next ?? {};
  const recency = cfg.recency ?? 0.6;
  const secondStep = cfg.secondStep ?? 0.4;
  const hub = cfg.hubDamping ?? 3;
  const boost = cfg.sectionBoost ?? 0.08;
  const score = new Map<string, number>();
  const why: Spread["why"] = new Map();
  const give = (id: string, part: number, link: GraphLink, from: string, seed: string) => {
    score.set(id, (score.get(id) ?? 0) + part);
    if (part > (why.get(id)?.part ?? 0)) why.set(id, { link, from, seed, part });
  };
  const sectionOnly = new Set<string>();

  // Recent steps count most; a step taken twice counts once, at its latest.
  const seeds = new Map<string, number>();
  for (const id of [...trail].reverse()) if (!seeds.has(id)) seeds.set(id, recency ** seeds.size);

  for (const [seed, w] of seeds) {
    if (seed.startsWith("section:")) {
      const type = cfg.sections?.[seed.slice(8)];
      if (!type) continue;
      for (const e of g.entities.values()) {
        if (e.type !== type) continue;
        // Within a section, the better-connected things first.
        score.set(e.id, (score.get(e.id) ?? 0) + w * boost * Math.min(1, degree(g, e.id) / 8));
        sectionOnly.add(e.id);
      }
      continue;
    }
    for (const l1 of g.adjacent.get(seed) ?? []) {
      const mid = otherEnd(l1, seed);
      const a = w * l1.weight * pullOf(g, l1.kind);
      give(mid, a, l1, seed, seed);
      // A busy entity (a platform everything runs on) passes on less of it.
      const carry = (a * secondStep) / Math.sqrt(1 + degree(g, mid) / hub);
      for (const l2 of g.adjacent.get(mid) ?? []) {
        const far = otherEnd(l2, mid);
        if (far === seed) continue;
        give(far, carry * l2.weight * pullOf(g, l2.kind), l2, mid, seed);
      }
    }
  }
  return { score, why, seeds, sectionOnly };
}

export interface NextOptions {
  limit?: number;
  exclude?: string[];
  accept?: (e: Entity) => boolean;
  templates?: Record<string, Template>;
}

/**
 * The next things to suggest after this trail: unseen, worth going to, and
 * mixed (never all of one type when there's a choice).
 */
export function predictNext(g: Graph, trail: string[], { limit = 3, exclude = [], accept, templates }: NextOptions = {}): Suggestion[] {
  const { score, why, seeds, sectionOnly } = spread(g, trail);
  const skip = new Set([...seeds.keys(), ...exclude]);
  const ranked = [...score.entries()]
    .map(([id, s]) => ({ entity: g.entities.get(id)!, s, w: why.get(id) }))
    .filter((x) => x.entity && (x.w || sectionOnly.has(x.entity.id)) && isDestination(g, x.entity) && !skip.has(x.entity.id) && (!accept || accept(x.entity)))
    .sort((a, b) => b.s - a.s);

  // Mixed when there's a choice, filled up when there isn't.
  const out: typeof ranked = [];
  const perType = new Map<string, number>();
  const cap = Math.max(1, limit - 1);
  for (const r of ranked) {
    if (out.length === limit) break;
    if ((perType.get(r.entity.type) ?? 0) >= cap) continue;
    perType.set(r.entity.type, (perType.get(r.entity.type) ?? 0) + 1);
    out.push(r);
  }
  for (const r of ranked) if (out.length < limit && !out.includes(r)) out.push(r);
  return out
    .sort((a, b) => b.s - a.s)
    .map((r) => {
      const reason: Reason = r.w ? reasonFromLink(r.w.link, r.entity.id, r.w.seed) : { kind: "section" };
      return { entity: r.entity, score: r.s, reason, text: renderReason(g, reason, r.entity, templates) };
    });
}

export interface AutocompleteOptions {
  limit?: number;
  accept?: (e: Entity) => boolean;
  templates?: Record<string, Template>;
}

/**
 * Type-ahead: entities whose name starts with (or contains) what's typed,
 * the ones nearest the visitor's trail first.
 */
export function autocomplete(g: Graph, typed: string, trail: string[] = [], { limit = 3, accept, templates }: AutocompleteOptions = {}): Suggestion[] {
  const q = normalize(typed);
  if (q.length < 2) return [];
  const near = spread(g, trail).score;
  const hits: { entity: Entity; rank: number; by: Reason["by"] }[] = [];
  for (const entity of g.entities.values()) {
    if (!isDestination(g, entity) || (accept && !accept(entity))) continue;
    const name = normalize(entity.label);
    const match = name.startsWith(q) ? 3 : name.split(" ").some((w) => w.startsWith(q)) ? 2 : q.length >= 3 && name.includes(q) ? 1 : 0;
    if (!match) continue;
    const by = match === 3 ? "prefix" : match === 2 ? "word-prefix" : "contains";
    hits.push({ entity, by, rank: match * 10 + (near.get(entity.id) ?? 0) * 5 + Math.min(degree(g, entity.id), 20) / 20 });
  }
  return hits
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((h) => {
      const reason: Reason = { kind: "typed", by: h.by };
      return { entity: h.entity, score: h.rank, reason, text: renderReason(g, reason, h.entity, templates) };
    });
}

export interface RelatedOptions {
  kinds?: string[];
  limit?: number;
  /** Only things worth going to. Default true. */
  destinationsOnly?: boolean;
  accept?: (e: Entity) => boolean;
  templates?: Record<string, Template>;
}

/** What is related to one entity, strongest link first, each with why. */
export function related(g: Graph, id: string, { kinds, limit = Infinity, destinationsOnly = true, accept, templates }: RelatedOptions = {}): Related[] {
  // Equal weights: the kind that pulls harder first.
  return neighbours(g, id, kinds)
    .sort((a, b) => b.link.weight - a.link.weight || pullOf(g, b.link.kind) - pullOf(g, a.link.kind))
    .filter(({ entity }) => (!destinationsOnly || isDestination(g, entity)) && (!accept || accept(entity)))
    .slice(0, limit)
    .map(({ entity, link }) => {
      const reason = reasonFromLink(link, entity.id);
      return { entity, link, weight: link.weight, reason, text: renderReason(g, reason, entity, templates) };
    });
}
