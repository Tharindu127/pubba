// The portfolio site's own engine (portfolioGraph.ts and suggest.ts, as of
// 9 Nov 2026), ported line for line with only its data sources swapped: ROLES,
// technologies and countries come from a PortfolioInput instead of the site's
// modules. The parity test runs it beside the library on the same data.
import type { PortfolioInput } from "../../src/presets/portfolio.ts";

type NodeType = "person" | "project" | "tech" | "role" | "market" | "area" | "game" | "creative" | "topic";
type Verb = "worked-as" | "founded" | "built-with" | "shipped-in" | "made-at" | "runs-on" | "same-stack" | "used-at" | "used-with" | "same-series" | "about" | "mentions";
export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
}
export interface GraphEdge {
  from: string;
  verb: Verb;
  to: string;
  weight: number;
  via?: string[];
}
export interface PortfolioGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjacent: Map<string, GraphEdge[]>;
}

const TECH_WEIGHT: Record<string, number> = { languages: 1, frameworks: 1, platforms: 0.7, design: 0.4, tools: 0.4 };
const CORE = 1;
const AREA_LABEL: Record<string, string> = {
  founded: "Founded by me",
  entertainment: "Entertainment",
  art: "Art",
  ps5: "PS5",
  pc: "PC",
  mobile: "Mobile games",
  twitch: "Twitch",
  discord: "Discord",
  youtube: "YouTube",
  medium: "Medium",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  website: "The web",
};
const NOT_A_NAME = new Set(["the", "app", "and", "for", "web", "android", "ios", "my", "student", "live", "squad"]);
const TOPICS: { key: string; label: string; re: RegExp }[] = [
  { key: "telecom", label: "Telecom", re: /\btelecom|\bsim\b|esim|roaming|\bmobile operator|ooredoo|vodafone|batelco|\byooz\b/i },
  { key: "fintech", label: "Fintech", re: /fintech|payment|\bpay later|buy[- ]now|\bwallet|\bbanking|\bqr pay/i },
  { key: "delivery", label: "Delivery & logistics", re: /deliver|logistic|courier|\bdriver|\bmerchant|last[- ]mile/i },
  { key: "education", label: "Education", re: /\bstudent|\beducat|\be-?learning|\bcourse|\buniversit|\bschool/i },
  { key: "research", label: "Research", re: /research|publication|conference|\br&d\b/i },
  { key: "ai", label: "AI", re: /\bai\b|artificial intelligence|machine learning|\bllm|\bgemini|\bgpt/i },
  { key: "music", label: "Music", re: /\bmusic|\bsynth|\bsing(er|ing)\b|\bsongs?\b|\bviolin/i },
  { key: "visual-art", label: "Visual art", re: /\bart\b|\bcinematic|\bvisual|\bphotograph|\bvideo/i },
  { key: "productivity", label: "Productivity", re: /\bcalculat|\bproductiv|\bplanner|\bmeeting|\bschedul/i },
];

const key = (s: string) => s.trim().toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, name: string) => new RegExp(`(^|[^a-z0-9])${escape(key(name))}([^a-z0-9]|$)`, "i").test(text);
type Project = PortfolioInput["projects"][number];
function callName(p: Project): string | null {
  return p.title.split(/[\s(),]+/).find((w) => w.length > 3 && !NOT_A_NAME.has(key(w))) ?? null;
}
const nodeId = {
  me: "me",
  project: (slug: string) => `project:${slug}`,
  tech: (name: string) => `tech:${name}`,
  role: (index: number | string) => `role:${index}`,
  market: (code: string) => `market:${code}`,
  area: (k: string) => `area:${key(k)}`,
  game: (id: string) => `game:${id}`,
  creative: (id: string) => `creative:${id}`,
  topic: (k: string) => `topic:${k}`,
};

export function buildGraph(data: PortfolioInput): PortfolioGraph {
  const ROLES = data.roles;
  const known = data.markets ?? [];
  const namesOf = (c: { name: string; aliases?: string[] }) => [c.name, ...(c.aliases ?? [])];
  const countriesNamedIn = (text: string) => known.filter((c) => namesOf(c).some((n) => mentions(text, n))).map((c) => c.code);
  const projectMarketCodes = (p: Project) => countriesNamedIn(`${p.category ?? ""} ${p.subtitle ?? ""} ${p.description ?? ""} ${p.fullDescription ?? ""}`);
  const ownerRe = new RegExp(escape(data.person.short ?? data.person.name.split(" ")[0]!), "i");

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const linked = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const add = (n: GraphNode) => (nodes.has(n.id) ? nodes.get(n.id)! : (nodes.set(n.id, n), n));
  const link = (from: string, verb: Verb, to: string, weight: number, via?: string[]) => {
    if (from === to || linked.has(pair(from, to))) return;
    linked.add(pair(from, to));
    edges.push({ from, verb, to, weight, ...(via ? { via } : {}) });
  };
  const area = (k: string, label = AREA_LABEL[key(k)] ?? k) => add({ id: nodeId.area(k), type: "area", label }).id;

  const techs = new Map(data.skills.map((t) => [key(t.name), t]));
  const techWeight = (name: string) => TECH_WEIGHT[key(String(techs.get(key(name))?.category ?? ""))] ?? 0.7;
  const markets = new Map(known.map((c) => [c.code, c]));
  const games = data.games ?? [];
  const creative = data.creative ?? [];

  add({ id: nodeId.me, type: "person", label: data.person.name });
  ROLES.forEach((r, i) => add({ id: nodeId.role(i), type: "role", label: `${r.title}, ${r.company}` }));
  for (const p of data.projects) add({ id: nodeId.project(p.slug), type: "project", label: p.title });
  for (const t of data.skills) add({ id: nodeId.tech(t.name), type: "tech", label: t.name });
  for (const g of games) add({ id: nodeId.game(g.id), type: "game", label: g.title });
  const KIND_WORD: Record<string, string> = { page: "page", channel: "channel", writing: "article", art: "piece" };
  for (const c of creative) {
    const own = ownerRe.test(c.title);
    add({ id: nodeId.creative(c.id), type: "creative", label: own ? `${AREA_LABEL[key(c.platform)] ?? c.platform} ${KIND_WORD[c.kind] ?? c.kind}` : c.title });
  }

  const texts: [string, string][] = [
    ...data.projects.map((p) => [nodeId.project(p.slug), `${p.title} ${p.subtitle ?? ""} ${p.description ?? ""} ${p.fullDescription ?? ""}`] as [string, string]),
    ...ROLES.map((r, i) => [nodeId.role(i), `${r.title} ${r.points.join(" ")}`] as [string, string]),
    ...games.map((g) => [nodeId.game(g.id), `${g.title} ${g.genre ?? ""} ${g.note ?? ""}`] as [string, string]),
    ...creative.map((c) => [nodeId.creative(c.id), `${c.title} ${c.description ?? ""}`] as [string, string]),
  ];

  ROLES.forEach((_, i) => link(nodeId.me, "worked-as", nodeId.role(i), 1));

  for (const p of data.projects) {
    const pid = nodeId.project(p.slug);
    if ((p.tags ?? []).some((t) => key(t) === "founded")) link(nodeId.me, "founded", pid, 1);
    for (const name of p.technologies) {
      const t = techs.get(key(name));
      link(pid, "built-with", add({ id: nodeId.tech(t?.name ?? name), type: "tech", label: t?.name ?? name }).id, techWeight(name));
    }
    for (const code of projectMarketCodes(p)) {
      const m = markets.get(code);
      if (m) link(pid, "shipped-in", add({ id: nodeId.market(code), type: "market", label: m.name }).id, 1);
    }
    const call = callName(p);
    if (call) ROLES.forEach((r, i) => mentions(`${r.title} ${r.points.join(" ")}`, call) && link(pid, "made-at", nodeId.role(i), 1));
    for (const c of (p.category ?? "").split(",").map((s) => s.trim()).filter(Boolean)) link(pid, "runs-on", area(c, c), 0.6);
    for (const t of p.tags ?? []) link(pid, "runs-on", area(t), 0.6);
  }
  for (const t of data.skills) {
    ROLES.forEach((r, i) => mentions(`${r.title} ${r.points.join(" ")}`, t.name) && link(nodeId.tech(t.name), "used-at", nodeId.role(i), techWeight(t.name)));
  }
  for (const g of games) {
    link(nodeId.game(g.id), "runs-on", area(g.platform), 0.6);
    for (const o of games) {
      if (o.id !== g.id && key(o.title).length > key(g.title).length && key(o.title).startsWith(`${key(g.title)} `)) link(nodeId.game(g.id), "same-series", nodeId.game(o.id), 1);
    }
  }
  for (const c of creative) link(nodeId.creative(c.id), "runs-on", area(c.platform), 0.5);

  const label = (k: string) => techs.get(k)?.name ?? k;
  const core = data.projects.map((p) => new Set(p.technologies.filter((n) => techWeight(n) >= CORE).map(key)));
  for (let a = 0; a < data.projects.length; a++) {
    for (let b = a + 1; b < data.projects.length; b++) {
      const shared = [...core[a]!].filter((k) => core[b]!.has(k));
      if (shared.length < 2) continue;
      const union = new Set([...core[a]!, ...core[b]!]).size;
      link(nodeId.project(data.projects[a]!.slug), "same-stack", nodeId.project(data.projects[b]!.slug), 0.5 + shared.length / union / 2, shared.map(label));
    }
  }
  const together = new Map<string, string[]>();
  for (const p of data.projects) {
    const list = [...new Set(p.technologies.filter((n) => techWeight(n) >= 0.7).map((n) => techs.get(key(n))?.name ?? n))];
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const k = pair(nodeId.tech(list[a]!), nodeId.tech(list[b]!));
        together.set(k, [...(together.get(k) ?? []), p.title]);
      }
    }
  }
  for (const [k, projects] of together) {
    if (projects.length < 2) continue;
    const [a, b] = k.split("|") as [string, string];
    link(a, "used-with", b, Math.min(projects.length / 4, 1), projects);
  }
  for (const [id, text] of texts) {
    for (const t of TOPICS) if (t.re.test(text)) link(id, "about", add({ id: nodeId.topic(t.key), type: "topic", label: t.label }).id, 0.7);
  }
  const named: { id: string; name: string }[] = [
    ...data.projects.flatMap((p) => {
      const call = callName(p);
      return call ? [{ id: nodeId.project(p.slug), name: call }] : [];
    }),
    ...data.skills.filter((t) => t.name.length > 3).map((t) => ({ id: nodeId.tech(t.name), name: t.name })),
  ];
  for (const [id, text] of texts) {
    for (const n of named) if (n.id !== id && mentions(text, n.name)) link(id, "mentions", n.id, 0.5);
    for (const code of countriesNamedIn(text)) {
      const m = markets.get(code);
      if (m) link(id, "mentions", add({ id: nodeId.market(code), type: "market", label: m.name }).id, 0.5);
    }
  }

  const adjacent = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    adjacent.set(e.from, [...(adjacent.get(e.from) ?? []), e]);
    adjacent.set(e.to, [...(adjacent.get(e.to) ?? []), e]);
  }
  for (const id of [...nodes.keys()]) if (!adjacent.has(id)) nodes.delete(id);
  return { nodes, edges, adjacent };
}

const DESTINATIONS = new Set<NodeType>(["project", "tech", "market", "role", "game", "creative"]);
const VERB_PULL: Record<Verb, number> = {
  "same-stack": 1,
  "same-series": 1,
  "built-with": 0.9,
  "shipped-in": 0.9,
  "made-at": 0.8,
  "used-with": 0.8,
  "used-at": 0.6,
  about: 0.75,
  "runs-on": 0.55,
  "worked-as": 0.7,
  founded: 0.8,
  mentions: 0.5,
};
const SECTION_TYPE: Record<string, NodeType> = { projects: "project", skills: "tech", reach: "market", experience: "role", games: "game", creative: "creative" };
const RECENCY = 0.6;
const SECOND_STEP = 0.4;

export interface Suggestion {
  node: GraphNode;
  score: number;
  why: { edge: GraphEdge; from: GraphNode } | null;
}
const degree = (g: PortfolioGraph, id: string) => g.adjacent.get(id)?.length ?? 0;

function spread(graph: PortfolioGraph, path: string[]) {
  const score = new Map<string, number>();
  const why = new Map<string, { edge: GraphEdge; from: string; part: number }>();
  const give = (id: string, part: number, edge: GraphEdge, from: string) => {
    score.set(id, (score.get(id) ?? 0) + part);
    if (part > (why.get(id)?.part ?? 0)) why.set(id, { edge, from, part });
  };
  const sectionOnly = new Set<string>();
  const seeds = new Map<string, number>();
  for (const id of [...path].reverse()) if (!seeds.has(id)) seeds.set(id, RECENCY ** seeds.size);
  for (const [seed, w] of seeds) {
    if (seed.startsWith("section:")) {
      const type = SECTION_TYPE[seed.slice(8)];
      if (!type) continue;
      for (const n of graph.nodes.values()) {
        if (n.type !== type) continue;
        score.set(n.id, (score.get(n.id) ?? 0) + w * 0.08 * Math.min(1, degree(graph, n.id) / 8));
        sectionOnly.add(n.id);
      }
      continue;
    }
    for (const e1 of graph.adjacent.get(seed) ?? []) {
      const mid = e1.from === seed ? e1.to : e1.from;
      const a = w * e1.weight * VERB_PULL[e1.verb];
      give(mid, a, e1, seed);
      const carry = (a * SECOND_STEP) / Math.sqrt(1 + degree(graph, mid) / 3);
      for (const e2 of graph.adjacent.get(mid) ?? []) {
        const far = e2.from === mid ? e2.to : e2.from;
        if (far === seed) continue;
        give(far, carry * e2.weight * VERB_PULL[e2.verb], e2, mid);
      }
    }
  }
  return { score, why, seeds, sectionOnly };
}

export function suggestNext(graph: PortfolioGraph, path: string[], { limit = 3 }: { limit?: number } = {}): Suggestion[] {
  const { score, why, seeds, sectionOnly } = spread(graph, path);
  const skip = new Set([...seeds.keys()]);
  const ranked = [...score.entries()]
    .map(([id, s]) => ({ node: graph.nodes.get(id)!, s, w: why.get(id) }))
    .filter((x) => x.node && (x.w || sectionOnly.has(x.node.id)) && DESTINATIONS.has(x.node.type) && !skip.has(x.node.id))
    .sort((a, b) => b.s - a.s);
  const out: typeof ranked = [];
  const perType = new Map<NodeType, number>();
  const cap = Math.max(1, limit - 1);
  for (const r of ranked) {
    if (out.length === limit) break;
    if ((perType.get(r.node.type) ?? 0) >= cap) continue;
    perType.set(r.node.type, (perType.get(r.node.type) ?? 0) + 1);
    out.push(r);
  }
  for (const r of ranked) if (out.length < limit && !out.includes(r)) out.push(r);
  return out.sort((a, b) => b.s - a.s).map((r) => ({ node: r.node, score: r.s, why: r.w ? { edge: r.w.edge, from: graph.nodes.get(r.w.from)! } : null }));
}

export function reason(s: Suggestion, ownerShort: string): string {
  const shortLabel = (n: GraphNode) => (n.type === "role" ? n.label.replace(/, [^,]+$/, "").replace(/\s+[—–-]\s+.*$/, "") : n.type === "person" ? ownerShort : n.label);
  const a = shortLabel(s.node);
  if (!s.why) return s.node.type === "game" ? `${a} is one he plays.` : `${a} is worth a look.`;
  const { edge, from } = s.why;
  const b = shortLabel(from);
  const forward = edge.from === s.node.id;
  const role = s.node.type === "role";
  const via = edge.via?.slice(0, 3).join(", ");
  switch (edge.verb) {
    case "same-stack":
      return `${a} is built on the same stack as ${b}${via ? ` (${via})` : ""}.`;
    case "same-series":
      return `${a} is from the same series as ${b}.`;
    case "built-with":
      return forward ? `${a} is built with ${b}.` : `${a} is part of ${b}'s stack.`;
    case "shipped-in":
      return forward ? `${a} shipped in ${b} too.` : `${a} is where ${b} shipped.`;
    case "made-at":
      return role ? `As ${a}, he built ${b}.` : `${a} is what he built as ${b}.`;
    case "used-with":
      return `${a} goes with ${b}${via ? `, as in ${via}` : ""}.`;
    case "used-at":
      return role ? `As ${a}, he worked with ${b}.` : `${a} was part of his work as ${b}.`;
    case "about":
      return `${a} is about ${b.toLowerCase()} too.`;
    case "runs-on":
      return `${a} is on ${b} as well.`;
    case "worked-as":
      return `${a} is one of his roles.`;
    case "founded":
      return `${a} is one of his own ventures.`;
    case "mentions":
      if (role && from.type === "market") return `As ${a}, he shipped to ${b}.`;
      if (s.node.type === "market" && from.type === "role") return `${a} is where he shipped as ${b}.`;
      return forward ? `${a} mentions ${b}.` : `${b} mentions ${a}.`;
  }
}
