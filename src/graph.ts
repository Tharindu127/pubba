import { lowerKey, mentions } from "./text.ts";
import type { CoOccurRule, Dataset, Entity, Graph, GraphLink, LabelPrefixRule, NamedInRule, PubbaConfig, Rule, SharedRule, TopicsRule } from "./types.ts";

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

class Builder {
  readonly entities = new Map<string, Entity>();
  readonly links: GraphLink[] = [];
  private readonly linked = new Set<string>();

  readonly config: PubbaConfig;

  constructor(config: PubbaConfig) {
    this.config = config;
  }

  add(e: Entity): Entity {
    const had = this.entities.get(e.id);
    if (had) return had;
    this.entities.set(e.id, e);
    return e;
  }

  /** One link per pair: the first, most specific relation wins. */
  link(l: Omit<GraphLink, "weight"> & { weight?: number }) {
    if (l.from === l.to || this.linked.has(pairKey(l.from, l.to))) return;
    if (!this.entities.has(l.from) || !this.entities.has(l.to)) return;
    this.linked.add(pairKey(l.from, l.to));
    const out: GraphLink = { from: l.from, kind: l.kind, to: l.to, weight: l.weight ?? this.weightOf(l.kind, l.from, l.to) };
    if (l.via) out.via = l.via;
    if (l.rule) out.rule = l.rule;
    this.links.push(out);
  }

  weightOf(kind: string, from: string, to: string): number {
    const k = this.config.kinds?.[kind];
    const end = k?.weightFrom === "from" ? from : k?.weightFrom === "to" ? to : null;
    const w = end ? this.entities.get(end)?.weight : undefined;
    return w ?? k?.weight ?? 1;
  }

  ofType(type: string): Entity[] {
    return [...this.entities.values()].filter((e) => e.type === type);
  }

  /** The targets an entity links out to through these kinds, in link order. */
  targets(id: string, kinds: string[], minWeight: number): Entity[] {
    const out: Entity[] = [];
    for (const l of this.links) {
      if (l.from !== id || !kinds.includes(l.kind)) continue;
      const t = this.entities.get(l.to);
      if (t && (t.weight ?? 1) >= minWeight && !out.includes(t)) out.push(t);
    }
    return out;
  }
}

function applyShared(b: Builder, r: SharedRule) {
  const items = b.ofType(r.among);
  const core = items.map((e) => b.targets(e.id, r.through, r.minWeight ?? 0));
  const min = r.min ?? 2;
  const base = r.base ?? 0.5;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = core[i]!;
      const c = core[j]!;
      const shared = a.filter((t) => c.includes(t));
      if (shared.length < min) continue;
      const union = new Set([...a, ...c]).size;
      b.link({ from: items[i]!.id, kind: r.kind, to: items[j]!.id, weight: base + ((1 - base) * shared.length) / union, via: shared.map((t) => t.label), rule: r.id ?? r.kind });
    }
  }
}

function applyCoOccur(b: Builder, r: CoOccurRule) {
  const together = new Map<string, string[]>();
  for (const item of b.entities.values()) {
    const list = b.targets(item.id, r.through, r.minWeight ?? 0).filter((t) => t.type === r.among);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const k = pairKey(list[i]!.id, list[j]!.id);
        together.set(k, [...(together.get(k) ?? []), item.label]);
      }
    }
  }
  const min = r.min ?? 2;
  const saturate = r.saturate ?? 4;
  for (const [k, items] of together) {
    if (items.length < min) continue;
    const [from, to] = k.split("|") as [string, string];
    b.link({ from, kind: r.kind, to, weight: Math.min(items.length / saturate, 1), via: items, rule: r.id ?? r.kind });
  }
}

const stem = (label: string) => lowerKey(label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " "));

function applyLabelPrefix(b: Builder, r: LabelPrefixRule) {
  const items = b.ofType(r.among);
  items.forEach((a, i) => {
    for (const o of items) {
      const ka = lowerKey(a.label);
      const ko = lowerKey(o.label);
      if (o.id !== a.id && ko.length > ka.length && ko.startsWith(`${ka} `)) b.link({ from: a.id, kind: r.kind, to: o.id, weight: r.weight ?? 1, rule: r.id ?? r.kind });
    }
    if (!r.stems || !a.label.includes("(")) return;
    for (const o of items.slice(i + 1)) if (stem(o.label) === stem(a.label)) b.link({ from: a.id, kind: r.kind, to: o.id, weight: r.weight ?? 1, rule: r.id ?? r.kind });
  });
}


function applyNamedIn(b: Builder, r: NamedInRule) {
  const minLen = (type: string) => (typeof r.minNameLength === "number" ? r.minNameLength : (r.minNameLength?.[type] ?? 0));
  const named: { entity: Entity; name: string }[] = [];
  for (const e of b.entities.values()) {
    if (!r.named.includes(e.type) || e.mentionAs === false) continue;
    for (const name of e.mentionAs ?? [e.label]) if (name.length >= minLen(e.type)) named.push({ entity: e, name });
  }
  const texts = [...b.entities.values()].filter((e) => e.text && (!r.in || r.in.includes(e.type)));
  const textToNamed = (r.direction ?? "text-to-named") === "text-to-named";
  const add = (text: Entity, n: Entity) => {
    const [from, to] = textToNamed ? [text.id, n.id] : [n.id, text.id];
    const weight = r.weightFrom === "named" ? (n.weight ?? r.weight ?? 1) : r.weightFrom === "text" ? (text.weight ?? r.weight ?? 1) : (r.weight ?? b.weightOf(r.kind, from, to));
    b.link({ from, kind: r.kind, to, weight, rule: r.id ?? r.kind });
  };
  if (textToNamed) {
    for (const t of texts) for (const n of named) if (n.entity.id !== t.id && mentions(t.text!, n.name)) add(t, n.entity);
  } else {
    for (const n of named) for (const t of texts) if (n.entity.id !== t.id && mentions(t.text!, n.name)) add(t, n.entity);
  }
}

function applyTopics(b: Builder, r: TopicsRule) {
  const topicType = r.topicType ?? "topic";
  const compiled = r.topics.map((t) => ({ ...t, re: typeof t.pattern === "string" ? new RegExp(t.pattern, "i") : t.pattern }));
  const texts = [...b.entities.values()].filter((e) => e.text && e.type !== topicType && (!r.in || r.in.includes(e.type)));
  for (const e of texts) {
    for (const t of compiled) {
      if (!t.re.test(e.text!)) continue;
      const topic = b.add({ id: `${topicType}:${t.key}`, type: topicType, label: t.label });
      b.link({ from: e.id, kind: r.kind, to: topic.id, weight: r.weight ?? b.weightOf(r.kind, e.id, topic.id), rule: r.id ?? r.kind });
    }
  }
}

function applyRule(b: Builder, r: Rule) {
  switch (r.type) {
    case "shared":
      return applyShared(b, r);
    case "co-occur":
      return applyCoOccur(b, r);
    case "label-prefix":
      return applyLabelPrefix(b, r);
    case "named-in":
      return applyNamedIn(b, r);
    case "topics":
      return applyTopics(b, r);
  }
}

/** `rules`, then `extraRules`, each extra placed before the rule it names. */
export function ruleOrder(config: PubbaConfig): Rule[] {
  const out = [...(config.rules ?? [])];
  for (const r of config.extraRules ?? []) {
    const at = r.before ? out.findIndex((x) => (x.id ?? x.kind) === r.before) : -1;
    if (at < 0) out.push(r);
    else out.splice(at, 0, r);
  }
  return out;
}

/**
 * The graph for a dataset: its entities, its links with weights resolved,
 * then the derived links from the config's rules, in order. A pair of
 * entities keeps only its first link, so the most specific relation wins.
 * Entities with no link at all are dropped: they have nothing to suggest.
 */
export function buildGraph(data: Dataset, config: PubbaConfig = {}): Graph {
  const b = new Builder(config);
  for (const e of data.entities) b.add(e);
  for (const l of data.links ?? []) b.link(l);
  for (const r of ruleOrder(config)) applyRule(b, r);

  const adjacent = new Map<string, GraphLink[]>();
  for (const l of b.links) {
    adjacent.set(l.from, [...(adjacent.get(l.from) ?? []), l]);
    adjacent.set(l.to, [...(adjacent.get(l.to) ?? []), l]);
  }
  for (const id of [...b.entities.keys()]) if (!adjacent.has(id)) b.entities.delete(id);
  return { entities: b.entities, links: b.links, adjacent, config };
}

export const degree = (g: Graph, id: string): number => g.adjacent.get(id)?.length ?? 0;

export const otherEnd = (l: GraphLink, id: string): string => (l.from === id ? l.to : l.from);

/** Every entity one link away, strongest link first. */
export function neighbours(g: Graph, id: string, kinds?: string[]): { entity: Entity; link: GraphLink }[] {
  const out: { entity: Entity; link: GraphLink }[] = [];
  for (const link of g.adjacent.get(id) ?? []) {
    if (kinds && !kinds.includes(link.kind)) continue;
    const entity = g.entities.get(otherEnd(link, id));
    if (entity) out.push({ entity, link });
  }
  return out.sort((x, y) => y.link.weight - x.link.weight);
}

export const isDestination = (g: Graph, e: Entity): boolean => g.config.types?.[e.type]?.destination ?? true;
