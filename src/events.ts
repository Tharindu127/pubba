import type { MatchResult, Reason } from "./types.ts";

/*
 * Privacy-safe measurement. pubba only emits: no storage, no network, no ids
 * for visitors or sessions, no timestamps. The site subscribes and decides
 * where events go (its own visit log, an analytics tool, or nowhere).
 *
 * Nothing a visitor typed can reach an event: the fields hold entity ids that
 * exist in the graph, link kinds, types, and goals the site declared up front.
 */

export const GUIDE_VIAS = ["suggestion", "chip", "typed", "match", "related"] as const;
export type GuideVia = (typeof GUIDE_VIAS)[number];

export type PubbaEvent =
  /** The site's guide (chat, panel, robot) was opened. */
  | { type: "guide-opened" }
  /** pubba suggested these entities (from `next` or `related`). */
  | { type: "suggested"; source: "next" | "related"; ids: string[]; reasonKinds: string[] }
  /** A typed query resolved: to what kind of thing, never what was asked. */
  | { type: "matched"; intent: MatchResult["intent"]; entityType?: string; by?: NonNullable<Reason["by"]> }
  /** The visitor followed the guide to an entity. */
  | { type: "guided-to"; to: string; entityType: string; via: GuideVia }
  /** The visitor reached one of the site's goals ("contact"). */
  | { type: "reached"; goal: string };

export type EventListener = (event: Readonly<PubbaEvent>) => void;

export interface Events {
  /** Listen to every event; returns an unsubscribe function. A listener that throws is ignored. */
  on(listener: EventListener): () => void;
  /** Goals `track.reached` accepts. */
  readonly goals: readonly string[];
  /** For pubba itself and tests: deliver an event to every listener. */
  emit(event: PubbaEvent): void;
}

export interface EventsOptions {
  /** Goals the site counts. Anything else passed to `track.reached` is dropped. Default ["contact", "resume"]. */
  goals?: string[];
}

export function createEvents({ goals = ["contact", "resume"] }: EventsOptions = {}): Events {
  const listeners = new Set<EventListener>();
  return {
    goals: Object.freeze([...goals]),
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      const frozen = Object.freeze({ ...event });
      for (const l of listeners) {
        try {
          l(frozen);
        } catch {
          // Measurement must never break the guide.
        }
      }
    },
  };
}

/** What one visit's events say, for a funnel: was the guide used, did it lead somewhere, which goals were reached. */
export interface VisitSummary {
  usedGuide: boolean;
  /** Entity ids the guide led to, in order, each once. */
  guidedTo: string[];
  /** Entity types the guide led to ("project"), each once. */
  guidedToTypes: string[];
  reached: string[];
  /** A goal was reached after the guide had led somewhere. */
  guidedBeforeGoal: boolean;
}

export function summarise(events: readonly PubbaEvent[]): VisitSummary {
  const guidedTo: string[] = [];
  const guidedToTypes: string[] = [];
  const reached: string[] = [];
  let usedGuide = false;
  let guidedBeforeGoal = false;
  for (const e of events) {
    if (e.type === "guide-opened" || e.type === "matched") usedGuide = true;
    if (e.type === "guided-to") {
      usedGuide = true;
      if (!guidedTo.includes(e.to)) guidedTo.push(e.to);
      if (!guidedToTypes.includes(e.entityType)) guidedToTypes.push(e.entityType);
    }
    if (e.type === "reached") {
      if (!reached.includes(e.goal)) reached.push(e.goal);
      if (guidedTo.length) guidedBeforeGoal = true;
    }
  }
  return { usedGuide, guidedTo, guidedToTypes, reached, guidedBeforeGoal };
}
