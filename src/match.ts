import { neighbours, isDestination } from "./graph.ts";
import { containsName, hasPhraseWith, normalize } from "./text.ts";
import { reasonFromLink, renderReason } from "./reasons.ts";
import type { Graph, Match, MatchResult, Reason, Related, Template, TypeMatchConfig } from "./types.ts";

export const DEFAULT_STOP_WORDS = ["the", "app", "and", "for", "web", "application", "mobile", "portal", "site", "website"];
export const DEFAULT_SIMILAR = "\\b(like|similar|alike|same stack|related to|anything else)\\b";

interface Scored {
  score: number;
  by: NonNullable<Reason["by"]>;
  name: string;
}

interface Settings {
  stop: Set<string>;
  typo: number;
  partial: boolean;
  /** Words that appear in only one entity's names, when distinct words count. */
  distinct: Set<string> | null;
}

const significant = (name: string, stop: Set<string>) => name.split(" ").filter((w) => w.length > 2 && !stop.has(w));

/** How well one name of an entity fits the query, by the type's match settings. */
function scoreName(q: string, name: string, isAlias: boolean, m: TypeMatchConfig, st: Settings): Scored | null {
  if (!name || name.length < (m.minLength ?? 0)) return null;
  const has = (w: string) => hasPhraseWith(q, [w], st.typo);
  if ((m.mode ?? "title") === "phrase") {
    return name.length > 1 && has(name) ? { score: 100 + name.length, by: isAlias ? "alias" : "phrase", name } : null;
  }
  if (containsName(q, name)) return { score: 100 + name.length, by: isAlias ? "alias" : "name", name };
  const words = significant(name, st.stop);
  const hits = words.filter(has).length;
  if (hits && hits === words.length && words.join("").length > (m.minWordsLength ?? 0)) return { score: 50 + hits, by: "words", name };
  if (st.partial && words.length >= 3 && hits >= 2 && hits === words.length - 1) return { score: 40 + hits, by: "words", name };
  const distinct = st.distinct && words.find((w) => w.length >= 5 && st.distinct!.has(w) && has(w));
  if (distinct) return { score: 25, by: "distinct-word", name: distinct };
  const first = words[0];
  if (m.firstWord && first && first.length > 3 && has(first)) return { score: 20, by: "first-word", name: first };
  return null;
}

const distinctCache = new WeakMap<Graph, Set<string>>();

/** Significant words that occur in the names of exactly one matchable entity. */
function distinctWords(g: Graph, stop: Set<string>): Set<string> {
  let out = distinctCache.get(g);
  if (out) return out;
  const owners = new Map<string, Set<string>>();
  for (const e of g.entities.values()) {
    if (g.config.types?.[e.type]?.match?.skip) continue;
    for (const raw of [e.label, ...(e.aliases ?? [])]) {
      for (const w of significant(normalize(raw), stop)) owners.set(w, (owners.get(w) ?? new Set()).add(e.id));
    }
  }
  out = new Set([...owners].filter(([, ids]) => ids.size === 1).map(([w]) => w));
  distinctCache.set(g, out);
  return out;
}

export interface SearchOptions {
  limit?: number;
  types?: string[];
  templates?: Record<string, Template>;
}

/**
 * Every entity a query could mean, best first: lower tiers before higher
 * ones, then by score. Typos, plurals, prefixes and short names are allowed;
 * a name containing an ignored word (the owner's own name) never counts.
 */
export function search(g: Graph, query: string, { limit = 10, types, templates }: SearchOptions = {}): Match[] {
  const q = normalize(query);
  if (!q) return [];
  const mc = g.config.match ?? {};
  const stop = new Set(mc.stopWords ?? DEFAULT_STOP_WORDS);
  const st: Settings = { stop, typo: mc.typoMinLength ?? 4, partial: mc.partialWords ?? false, distinct: mc.distinctWords ? distinctWords(g, stop) : null };
  const ignore = (mc.ignore ?? []).map(normalize).filter(Boolean);
  const out: Match[] = [];
  for (const entity of g.entities.values()) {
    if (types && !types.includes(entity.type)) continue;
    const m = g.config.types?.[entity.type]?.match ?? {};
    if (m.skip) continue;
    let best: Scored | null = null;
    const names: [string, boolean][] = [[entity.label, false], ...(entity.aliases ?? []).map((a): [string, boolean] => [a, true])];
    for (const [raw, isAlias] of names) {
      const name = normalize(raw);
      if (ignore.some((w) => name.includes(w))) continue;
      const s = scoreName(q, name, isAlias, m, st);
      if (s && (!best || s.score > best.score)) best = s;
    }
    if (!best) continue;
    const reason: Reason = { kind: "match", by: best.by, name: best.name };
    out.push({ entity, score: best.score, tier: m.tier ?? 1, reason, text: renderReason(g, reason, entity, templates) });
  }
  // Stable: equal scores keep the dataset's order.
  return out.sort((a, b) => a.tier - b.tier || b.score - a.score).slice(0, limit);
}

export interface MatchOptions {
  /** How many similar things to return for "anything like X?". Default 3. */
  similarLimit?: number;
  templates?: Record<string, Template>;
}

/**
 * What a typed query means: one entity, things like one, or nothing here.
 * "Anything like X?" returns X's neighbours by the type's `similar` kinds.
 */
export function match(g: Graph, query: string, { similarLimit = 3, templates }: MatchOptions = {}): MatchResult {
  const best = search(g, query, { limit: 1, ...(templates ? { templates } : {}) })[0] ?? null;
  if (!best) return { query, intent: "none", entity: null, match: null, similar: [] };
  const q = normalize(query);
  const similarRe = new RegExp(g.config.match?.similarPattern ?? DEFAULT_SIMILAR);
  if (similarRe.test(q)) {
    const kinds = g.config.types?.[best.entity.type]?.similar;
    const similar: Related[] = neighbours(g, best.entity.id, kinds)
      .filter(({ entity }) => isDestination(g, entity))
      .slice(0, similarLimit)
      .map(({ entity, link }) => {
        const reason = reasonFromLink(link, entity.id);
        return { entity, link, weight: link.weight, reason, text: renderReason(g, reason, entity, templates) };
      });
    if (similar.length) return { query, intent: "similar", entity: best.entity, match: best, similar };
  }
  return { query, intent: "entity", entity: best.entity, match: best, similar: [] };
}

