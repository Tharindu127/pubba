import { assembleGraph } from "./graph.ts";
import { DEFAULT_STOP_WORDS, distinctWords } from "./match.ts";
import { VERSION } from "./version.ts";
import type { Entity, Graph, GraphLink, PubbaConfig, Template } from "./types.ts";

/*
 * A compiled bundle: the final graph and the runtime settings as one JSON file.
 * Rules, topic patterns and anything else that needs the TypeScript builder are
 * applied at compile time and never ship, so a runtime in any language only
 * loads the file and answers. The format is versioned; order is part of it
 * (it decides ties).
 */

export const BUNDLE_FORMAT = 1;

export type BundleEntity = Pick<Entity, "id" | "type" | "label" | "short" | "aliases" | "url" | "text" | "data">;

export interface Bundle {
  format: number;
  compiler: string;
  config: Pick<PubbaConfig, "types" | "kinds" | "next" | "match" | "templates">;
  entities: BundleEntity[];
  unlinked: BundleEntity[];
  links: GraphLink[];
  index: { distinctWords: string[] };
}

export interface CompileOptions {
  /** Keep each entity's `text` and `data` (descriptions, images…), for exports. Default false: smaller bundles for apps. */
  withData?: boolean;
}

function entityFor(e: Entity, withData: boolean): BundleEntity {
  const out: BundleEntity = { id: e.id, type: e.type, label: e.label };
  if (e.short !== undefined) out.short = e.short;
  if (e.aliases?.length) out.aliases = [...e.aliases];
  if (e.url !== undefined) out.url = e.url;
  if (withData && e.text !== undefined) out.text = e.text;
  if (withData && e.data !== undefined) out.data = e.data;
  return out;
}

/** Templates must be text to cross languages; a function template names itself in the error. */
function portableTemplates(templates: Record<string, Template> | undefined): Record<string, Exclude<Template, (...a: never[]) => unknown>> | undefined {
  if (!templates) return undefined;
  const out: Record<string, Exclude<Template, (...a: never[]) => unknown>> = {};
  for (const [k, t] of Object.entries(templates)) {
    if (typeof t === "function") throw new Error(`pubba compile: the "${k}" template is a function; bundles need text templates (cases cover type and direction)`);
    out[k] = t;
  }
  return out;
}

/** The runtime settings only: no rules, no weights a runtime doesn't use. */
function runtimeConfig(c: PubbaConfig): Bundle["config"] {
  const out: Bundle["config"] = {};
  if (c.types) {
    out.types = {};
    for (const [k, t] of Object.entries(c.types)) {
      out.types[k] = {
        ...(t.label !== undefined ? { label: t.label } : {}),
        ...(t.plural !== undefined ? { plural: t.plural } : {}),
        ...(t.destination !== undefined ? { destination: t.destination } : {}),
        ...(t.match ? { match: { ...t.match } } : {}),
        ...(t.similar ? { similar: [...t.similar] } : {}),
      };
    }
  }
  if (c.kinds) {
    out.kinds = {};
    for (const [k, v] of Object.entries(c.kinds)) out.kinds[k] = { ...(v.label !== undefined ? { label: v.label } : {}), ...(v.pull !== undefined ? { pull: v.pull } : {}) };
  }
  if (c.next) out.next = { ...c.next, ...(c.next.sections ? { sections: { ...c.next.sections } } : {}) };
  if (c.match) out.match = { ...c.match };
  const templates = portableTemplates(c.templates);
  if (templates) out.templates = templates;
  return JSON.parse(JSON.stringify(out)) as Bundle["config"];
}

/** A graph as a bundle, ready to write as JSON and load in any runtime. */
export function compileBundle(g: Graph, { withData = false }: CompileOptions = {}): Bundle {
  const stop = new Set(g.config.match?.stopWords ?? DEFAULT_STOP_WORDS);
  return {
    format: BUNDLE_FORMAT,
    compiler: `pubba@${VERSION}`,
    config: runtimeConfig(g.config),
    entities: [...g.entities.values()].map((e) => entityFor(e, withData)),
    unlinked: [...g.unlinked.values()].map((e) => entityFor(e, withData)),
    links: g.links.map((l) => ({ from: l.from, kind: l.kind, to: l.to, weight: l.weight, ...(l.via ? { via: [...l.via] } : {}), ...(l.rule ? { rule: l.rule } : {}) })),
    index: { distinctWords: [...distinctWords(g, stop)].sort() },
  };
}

/** The graph inside a bundle, after checking it is one this runtime can read. */
export function graphFromBundle(bundle: unknown): Graph {
  const b = bundle as Partial<Bundle> | null;
  if (!b || typeof b !== "object" || typeof b.format !== "number" || !Array.isArray(b.entities) || !Array.isArray(b.links)) {
    throw new Error("pubba: not a pubba bundle");
  }
  if (Math.floor(b.format) > BUNDLE_FORMAT) throw new Error(`pubba: bundle format ${b.format} is newer than this runtime reads (${BUNDLE_FORMAT}); upgrade pubba`);
  const entities = [...b.entities, ...(b.unlinked ?? [])] as Entity[];
  const config = (b.config ?? {}) as PubbaConfig;
  return assembleGraph(entities, b.links as GraphLink[], config, b.index ? { distinctWords: [...b.index.distinctWords] } : undefined);
}
