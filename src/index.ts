import { buildGraph } from "./graph.ts";
import { autocomplete, predictNext, related, type AutocompleteOptions, type NextOptions, type RelatedOptions } from "./next.ts";
import { match, search, type MatchOptions, type SearchOptions } from "./match.ts";
import { renderReason } from "./reasons.ts";
import type { Dataset, Entity, Graph, MatchResult, Match, PubbaConfig, Reason, Related, Suggestion, Template } from "./types.ts";

export * from "./types.ts";
export { buildGraph, neighbours, degree, isDestination } from "./graph.ts";
export { predictNext, autocomplete, related, spread } from "./next.ts";
export type { NextOptions, AutocompleteOptions, RelatedOptions } from "./next.ts";
export { match, search, DEFAULT_STOP_WORDS, DEFAULT_SIMILAR } from "./match.ts";
export type { MatchOptions, SearchOptions } from "./match.ts";
export { renderReason, reasonFromLink, shortLabel, DEFAULT_TEMPLATES } from "./reasons.ts";
export { createTrail, sectionStep } from "./trail.ts";
export type { Trail, TrailOptions, TrailStorage } from "./trail.ts";
export { normalize, editDistance, closeTo, hasPhrase, hasPhraseWith, mentions } from "./text.ts";

/**
 * Layers configs: types, kinds, templates and the `next` and `match` settings
 * merge key by key; `rules` from a later config replace earlier ones whole,
 * while `extraRules` add up.
 */
export function mergeConfig(...configs: (PubbaConfig | undefined)[]): PubbaConfig {
  const out: PubbaConfig = {};
  for (const c of configs) {
    if (!c) continue;
    if (c.types) {
      out.types = { ...out.types };
      for (const [k, v] of Object.entries(c.types)) out.types[k] = { ...out.types[k], ...v, ...(v.match ? { match: { ...out.types[k]?.match, ...v.match } } : {}) };
    }
    if (c.kinds) {
      out.kinds = { ...out.kinds };
      for (const [k, v] of Object.entries(c.kinds)) out.kinds[k] = { ...out.kinds[k], ...v };
    }
    if (c.rules) out.rules = [...c.rules];
    if (c.extraRules) out.extraRules = [...(out.extraRules ?? []), ...c.extraRules];
    if (c.next) out.next = { ...out.next, ...c.next, ...(c.next.sections ? { sections: { ...out.next?.sections, ...c.next.sections } } : {}) };
    if (c.match) out.match = { ...out.match, ...c.match };
    if (c.templates) out.templates = { ...out.templates, ...c.templates };
  }
  return out;
}

/** The graph plus everything asked of it, in one object. */
export interface Pubba {
  graph: Graph;
  get(id: string): Entity | undefined;
  /** What is related to one entity, strongest first, each with why. */
  related(id: string, options?: RelatedOptions): Related[];
  /** The likeliest next things after a trail. */
  next(trail: string[], options?: NextOptions): Suggestion[];
  /** Type-ahead, nearest the trail first. */
  autocomplete(typed: string, trail?: string[], options?: AutocompleteOptions): Suggestion[];
  /** Every entity a query could mean, best first. */
  search(query: string, options?: SearchOptions): Match[];
  /** What a query means: one entity, things like one, or nothing. */
  match(query: string, options?: MatchOptions): MatchResult;
  /** A reason as a sentence, with templates layered over the config's. */
  explain(reason: Reason, item: Entity | string, templates?: Record<string, Template>): string;
}

/** Builds the graph for a dataset and config, once, and answers from it. */
export function createPubba(data: Dataset, config: PubbaConfig = {}): Pubba {
  const graph = buildGraph(data, config);
  return {
    graph,
    get: (id) => graph.entities.get(id),
    related: (id, o) => related(graph, id, o),
    next: (trail, o) => predictNext(graph, trail, o),
    autocomplete: (typed, trail = [], o) => autocomplete(graph, typed, trail, o),
    search: (q, o) => search(graph, q, o),
    match: (q, o) => match(graph, q, o),
    explain: (reason, item, templates) => {
      const e = typeof item === "string" ? graph.entities.get(item) : item;
      if (!e) throw new Error(`pubba: no entity ${String(item)}`);
      return renderReason(graph, reason, e, templates);
    },
  };
}

