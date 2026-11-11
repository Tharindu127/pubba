import { buildGraph } from "./graph.ts";
import { graphFromBundle } from "./bundle.ts";
import { autocomplete, predictNext, related, type AutocompleteOptions, type NextOptions, type RelatedOptions } from "./next.ts";
import { match, search, type MatchOptions, type SearchOptions } from "./match.ts";
import { renderReason } from "./reasons.ts";
import { GUIDE_VIAS, type Events, type GuideVia } from "./events.ts";
import type { Dataset, Entity, Graph, MatchResult, Match, PubbaConfig, Reason, Related, Suggestion, Template } from "./types.ts";

export * from "./types.ts";
export { buildGraph, assembleGraph, neighbours, degree, isDestination } from "./graph.ts";
export { predictNext, autocomplete, related, spread } from "./next.ts";
export type { NextOptions, AutocompleteOptions, RelatedOptions } from "./next.ts";
export { match, search, DEFAULT_STOP_WORDS, DEFAULT_SIMILAR } from "./match.ts";
export type { MatchOptions, SearchOptions } from "./match.ts";
export { renderReason, reasonFromLink, shortLabel, DEFAULT_TEMPLATES } from "./reasons.ts";
export { createTrail, sectionStep } from "./trail.ts";
export type { Trail, TrailOptions, TrailStorage } from "./trail.ts";
export { createEvents, summarise, GUIDE_VIAS } from "./events.ts";
export { compileBundle, graphFromBundle, BUNDLE_FORMAT } from "./bundle.ts";
export type { Bundle, BundleEntity, CompileOptions } from "./bundle.ts";
export { VERSION } from "./version.ts";
export { createGuide, DEFAULT_GUIDE_TEMPLATES } from "./guide.ts";
export type { Guide, GuideOptions, GuideTemplates, NudgePolicy, Reply, ReplyKind, Chip, EntityChip, QuestionChip, ChipContext } from "./guide.ts";
export type { Events, EventsOptions, EventListener, PubbaEvent, GuideVia, VisitSummary } from "./events.ts";
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

/** The moments a site reports to its measurement, checked so no visitor text gets in. */
export interface Track {
  guideOpened(): void;
  /** The visitor followed the guide to an entity. Unknown ids are dropped; returns whether it was emitted. */
  guidedTo(id: string, via: GuideVia): boolean;
  /** The visitor reached a goal. Goals the site didn't declare are dropped; returns whether it was emitted. */
  reached(goal: string): boolean;
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
  /** Report guide moments to `events`. Does nothing without them. */
  track: Track;
}

export interface CreateOptions {
  /** Where pubba's measurement events go (`createEvents()`). Without it, nothing is emitted. */
  events?: Events;
}

/** Builds the graph for a dataset and config, once, and answers from it. */
export function createPubba(data: Dataset, config: PubbaConfig = {}, options: CreateOptions = {}): Pubba {
  return pubbaFor(buildGraph(data, config), options);
}

/** Answers from a compiled bundle (`pubba compile`): the same answers as the content it was compiled from. */
export function loadBundle(bundle: unknown, options: CreateOptions = {}): Pubba {
  return pubbaFor(graphFromBundle(bundle), options);
}

/** Everything asked of a graph, however it was made. */
export function pubbaFor(graph: Graph, { events }: CreateOptions = {}): Pubba {
  const find = (id: string) => graph.entities.get(id) ?? graph.unlinked.get(id);
  const suggested = <T extends { entity: Entity; reason: Reason }>(source: "next" | "related", out: T[]): T[] => {
    if (events && out.length) {
      events.emit({ type: "suggested", source, ids: out.map((x) => x.entity.id), reasonKinds: [...new Set(out.map((x) => x.reason.kind))] });
    }
    return out;
  };
  return {
    graph,
    get: (id) => graph.entities.get(id),
    related: (id, o) => suggested("related", related(graph, id, o)),
    next: (trail, o) => suggested("next", predictNext(graph, trail, o)),
    autocomplete: (typed, trail = [], o) => autocomplete(graph, typed, trail, o),
    search: (q, o) => search(graph, q, o),
    match: (q, o) => {
      const m = match(graph, q, o);
      // What kind of thing it resolved to, never the query.
      if (events) events.emit({ type: "matched", intent: m.intent, ...(m.entity ? { entityType: m.entity.type } : {}), ...(m.match?.reason.by ? { by: m.match.reason.by } : {}) });
      return m;
    },
    explain: (reason, item, templates) => {
      const e = typeof item === "string" ? graph.entities.get(item) : item;
      if (!e) throw new Error(`pubba: no entity ${String(item)}`);
      return renderReason(graph, reason, e, templates);
    },
    track: {
      guideOpened: () => events?.emit({ type: "guide-opened" }),
      guidedTo: (id, via) => {
        const e = find(id);
        // Checked at runtime too: a plain-JavaScript caller could pass anything.
        if (!events || !e || !(GUIDE_VIAS as readonly string[]).includes(via)) return false;
        events.emit({ type: "guided-to", to: e.id, entityType: e.type, via });
        return true;
      },
      reached: (goal) => {
        if (!events || !events.goals.includes(goal)) return false;
        events.emit({ type: "reached", goal });
        return true;
      },
    },
  };
}
