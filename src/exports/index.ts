import { isDestination, neighbours } from "../graph.ts";
import { related } from "../next.ts";
import type { Entity, Graph } from "../types.ts";

/*
 * Small exports from the graph: schema.org JSON-LD and an llms.txt. The full
 * exports feature is planned for v2; these are what the Claude skill calls.
 */

type Json = Record<string, unknown>;

export interface JsonLdOptions {
  /** The person the site is about. Default: the first entity of type `person`. */
  person?: string;
  /** Makes relative urls absolute, and is the person's url when they have none. */
  baseUrl?: string;
  /** schema.org type per entity type; null leaves a type out. */
  types?: Record<string, string | null>;
  /** Types whose entities are the person's `knowsAbout`. Default ["tech"]. */
  skillTypes?: string[];
  /** Types that are jobs; their `data.company` becomes `worksFor` while current. Default ["role"]. */
  roleTypes?: string[];
  /** Types whose entities are topics, used for `about`. Default ["topic"]. */
  topicTypes?: string[];
  /** Platform types, used for `operatingSystem`. Default ["area"]. */
  platformTypes?: string[];
  /** Publish the person's email (`data.email`). Default false. */
  includeEmail?: boolean;
}

const DEFAULT_SCHEMA_TYPES: Record<string, string | null> = { project: "SoftwareApplication", creative: "CreativeWork" };

const absolute = (url: string | undefined, base?: string) => {
  if (!url) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
};
const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const clean = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
const description = (e: Entity) => str(e.data?.description);
const sentence = (s: string | undefined) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
const current = (e: Entity) => !str(e.data?.end) || /present|now|current/i.test(String(e.data?.end));

/** schema.org JSON-LD for the site: a Person, and their work as SoftwareApplication and CreativeWork, linked by creator, knowsAbout and worksFor. */
export function toJsonLd(g: Graph, o: JsonLdOptions = {}): Json {
  const schemaTypes = { ...DEFAULT_SCHEMA_TYPES, ...o.types };
  const skillTypes = o.skillTypes ?? ["tech"];
  const roleTypes = o.roleTypes ?? ["role"];
  const topicTypes = o.topicTypes ?? ["topic"];
  const platformTypes = o.platformTypes ?? ["area"];
  const all = [...g.entities.values()];
  const person = o.person ? g.entities.get(o.person) : all.find((e) => e.type === "person");
  const personUrl = absolute(person?.url, o.baseUrl) ?? absolute("/", o.baseUrl);
  const personId = person ? `${personUrl ?? ""}#${person.id}` : undefined;
  const idOf = (e: Entity) => `${absolute(e.url, o.baseUrl) ?? personUrl ?? ""}#${e.id}`;
  const near = (e: Entity, types: string[]) => neighbours(g, e.id).filter((n) => types.includes(n.entity.type)).map((n) => n.entity);

  const nodes: Json[] = [];
  if (person) {
    const sameAs = Array.isArray(person.data?.sameAs) ? (person.data.sameAs as unknown[]).map((s) => absolute(str(s))).filter(Boolean) : [];
    nodes.push(
      clean({
        "@type": "Person",
        "@id": personId,
        name: person.label,
        url: personUrl,
        jobTitle: str(person.data?.jobTitle),
        description: description(person),
        image: absolute(str(person.data?.image), o.baseUrl),
        email: o.includeEmail ? str(person.data?.email) : undefined,
        sameAs,
        knowsAbout: all.filter((e) => skillTypes.includes(e.type)).map((e) => e.label),
        worksFor: all
          .filter((e) => roleTypes.includes(e.type) && current(e) && str(e.data?.company))
          .map((e) => ({ "@type": "Organization", name: str(e.data?.company) })),
      })
    );
  }
  for (const e of all) {
    const type = schemaTypes[e.type];
    if (!type) continue;
    const platforms = near(e, platformTypes).map((x) => x.label);
    nodes.push(
      clean({
        "@type": type,
        "@id": idOf(e),
        name: e.label,
        url: absolute(e.url, o.baseUrl),
        description: description(e),
        image: absolute(str(e.data?.image), o.baseUrl),
        dateCreated: str(e.data?.date),
        keywords: near(e, skillTypes).map((x) => x.label).join(", ") || undefined,
        about: near(e, topicTypes).map((x) => ({ "@type": "Thing", name: x.label })),
        ...(type === "SoftwareApplication" ? { operatingSystem: platforms.join(", ") || undefined, applicationCategory: str(e.data?.applicationCategory) } : {}),
        creator: personId ? { "@id": personId } : undefined,
      })
    );
  }
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** Problems that would make the JSON-LD invalid or useless. Empty when it is fine. */
export function validateJsonLd(doc: Json): string[] {
  const problems: string[] = [];
  if (doc["@context"] !== "https://schema.org") problems.push(`@context should be "https://schema.org"`);
  const graph = doc["@graph"];
  if (!Array.isArray(graph) || !graph.length) return [...problems, "@graph is missing or empty"];
  const ids = new Set<string>();
  graph.forEach((n: Json, i) => {
    const where = `@graph[${i}]${typeof n.name === "string" ? ` (${n.name})` : ""}`;
    if (typeof n["@type"] !== "string") problems.push(`${where}: no @type`);
    if (typeof n.name !== "string" || !n.name) problems.push(`${where}: no name`);
    if (typeof n["@id"] === "string") {
      if (ids.has(n["@id"])) problems.push(`${where}: duplicate @id ${n["@id"]}`);
      ids.add(n["@id"]);
    }
    for (const k of ["url", "image"]) if (n[k] !== undefined && !/^https?:\/\//.test(String(n[k]))) problems.push(`${where}: ${k} should be an absolute http(s) url`);
  });
  for (const n of graph as Json[]) {
    const ref = (n.creator as Json | undefined)?.["@id"];
    if (typeof ref === "string" && !ids.has(ref)) problems.push(`${String(n.name)}: creator ${ref} is not in the graph`);
  }
  return problems;
}

export interface LlmsTxtOptions {
  person?: string;
  baseUrl?: string;
  /** Site title. Default: the person's name. */
  title?: string;
  /** One-line summary for the blockquote. Default: the person's description. */
  summary?: string;
  /** Which types get a section, in order. Default: every destination type, in config order. */
  types?: string[];
}

/** An llms.txt (llmstxt.org): the site in plain Markdown for AI assistants, one section per type. */
export function toLlmsTxt(g: Graph, o: LlmsTxtOptions = {}): string {
  const all = [...g.entities.values()];
  const person = o.person ? g.entities.get(o.person) : all.find((e) => e.type === "person");
  const typeOrder = o.types ?? [...new Set([...Object.keys(g.config.types ?? {}), ...all.map((e) => e.type)])].filter((t) => all.some((e) => e.type === t && isDestination(g, e)));
  const lines = [`# ${o.title ?? person?.label ?? "Site"}`, ""];
  const summary = o.summary ?? (person ? description(person) : undefined);
  if (summary) lines.push(`> ${summary}`, "");
  if (person && str(person.data?.jobTitle)) lines.push(`${person.label} is a ${str(person.data?.jobTitle)}.`, "");
  for (const type of typeOrder) {
    const items = all.filter((e) => e.type === type && isDestination(g, e));
    if (!items.length) continue;
    lines.push(`## ${g.config.types?.[type]?.plural ?? type}`, "");
    for (const e of items) {
      const url = absolute(e.url, o.baseUrl);
      const name = url ? `[${e.label}](${url})` : e.label;
      const strongest = related(g, e.id, { limit: 3 }).map((r) => r.entity.label);
      const note = [sentence(description(e)), strongest.length ? `Linked to ${strongest.join(", ")}.` : undefined].filter(Boolean).join(" ");
      lines.push(`- ${name}${note ? `: ${note}` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
