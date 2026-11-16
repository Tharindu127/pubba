import { allEntities, isDestination, neighbours } from "../graph.ts";
import { related } from "../next.ts";
import type { Entity, Graph } from "../types.ts";
import { VERSION } from "../version.ts";

/*
 * What a site publishes from its graph, built at build time: schema.org JSON-LD,
 * llms.txt and llms-full.txt, a knowledge file for AI assistants, and sitemap
 * entries. Runtimes don't need any of it, so it is TypeScript only.
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
  /** Platform types, used for `operatingSystem` when an entity has no `data.operatingSystem`. Default ["area"]. */
  platformTypes?: string[];
  /** Publish the person's email (`data.email`). Default false. */
  includeEmail?: boolean;
  /** The person's `knowsAbout`, curated: free text ("iOS development") or skill labels. Default: every skill. */
  knowsAbout?: string[];
  /** Only these entities (by id) besides the person: one project's page, say. Default: all. */
  include?: string[];
  /** Add an `ItemList` of one type's entities, in order: the projects page, say. A type, or the type with the list's own name and url. */
  itemList?: string | { type: string; name?: string; url?: string };
  /** Add a `BreadcrumbList` ending at this entity: a project's page. `parents` are the pages above it, from the top. Default: the site's home page. */
  breadcrumb?: string | { id: string; parents?: { name: string; url: string }[] };
  /** Add the person's jobs as `hasOccupation` (each role type entity), alongside `worksFor`. Default false. */
  occupations?: boolean;
}

/** One page of an `ItemList` or `BreadcrumbList`. */
const listItem = (position: number, name: string, url: string | undefined): Json => clean({ "@type": "ListItem", position, name, item: url });

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
/** The fullest description, for JSON-LD: `data.longDescription`, else `data.description`. */
const longDescription = (e: Entity) => str(e.data?.longDescription) ?? description(e);
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
  // The person may have no links of their own (no roles yet): they are still who the site is about.
  const person = o.person ? (g.entities.get(o.person) ?? g.unlinked?.get(o.person)) : allEntities(g).find((e) => e.type === "person");
  const personUrl = absolute(person?.url, o.baseUrl) ?? absolute("/", o.baseUrl);
  const personId = person ? `${personUrl ?? ""}#${person.id}` : undefined;
  // Ids stay on the site: an item hosted elsewhere (a Medium article) gets one under the site's url.
  const site = (() => {
    try {
      return new URL(o.baseUrl ?? personUrl ?? "").origin;
    } catch {
      return undefined;
    }
  })();
  const idOf = (e: Entity) => {
    const own = absolute(e.url, o.baseUrl);
    return `${own && site && own.startsWith(`${site}/`) ? own : (personUrl ?? "")}#${e.id}`;
  };
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
        knowsAbout: o.knowsAbout ?? all.filter((e) => skillTypes.includes(e.type)).map((e) => e.label),
        worksFor: all
          .filter((e) => roleTypes.includes(e.type) && current(e) && str(e.data?.company))
          .map((e) => ({ "@type": "Organization", name: str(e.data?.company) })),
        hasOccupation: o.occupations
          ? all
              .filter((e) => roleTypes.includes(e.type))
              .map((e) =>
                clean({
                  "@type": "Occupation",
                  name: str(e.data?.title) ?? e.label,
                  description: description(e),
                  skills: near(e, skillTypes).map((x) => x.label).join(", ") || undefined,
                })
              )
          : undefined,
      })
    );
  }
  for (const e of all) {
    const type = schemaTypes[e.type];
    if (!type || (o.include && !o.include.includes(e.id))) continue;
    const platforms = near(e, platformTypes).map((x) => x.label);
    nodes.push(
      clean({
        "@type": type,
        "@id": idOf(e),
        name: e.label,
        url: absolute(e.url, o.baseUrl),
        headline: str(e.data?.headline),
        description: longDescription(e),
        image: absolute(str(e.data?.image), o.baseUrl),
        dateCreated: str(e.data?.date),
        keywords: near(e, skillTypes).map((x) => x.label).join(", ") || undefined,
        about: near(e, topicTypes).map((x) => ({ "@type": "Thing", name: x.label })),
        ...(type === "SoftwareApplication"
          ? { operatingSystem: str(e.data?.operatingSystem) ?? (platforms.join(", ") || undefined), applicationCategory: str(e.data?.applicationCategory) }
          : {}),
        creator: personId ? { "@id": personId } : undefined,
      })
    );
  }
  if (o.itemList) {
    const list = typeof o.itemList === "string" ? { type: o.itemList } : o.itemList;
    const items = all.filter((e) => e.type === list.type && isDestination(g, e));
    const url = absolute(list.url, o.baseUrl);
    nodes.push(
      clean({
        "@type": "ItemList",
        "@id": `${url ?? personUrl ?? ""}#list-${list.type}`,
        name: list.name ?? g.config.types?.[list.type]?.plural ?? list.type,
        url,
        numberOfItems: items.length,
        itemListElement: items.map((e, i) => listItem(i + 1, e.label, absolute(e.url, o.baseUrl))),
      })
    );
  }
  if (o.breadcrumb) {
    const crumb = typeof o.breadcrumb === "string" ? { id: o.breadcrumb } : o.breadcrumb;
    const e = g.entities.get(crumb.id) ?? g.unlinked?.get(crumb.id);
    if (e) {
      const home = site ? [{ name: "Home", url: `${site}/` }] : [];
      const pages = [...(crumb.parents ?? home).map((p) => ({ name: p.name, url: absolute(p.url, o.baseUrl) })), { name: e.label, url: absolute(e.url, o.baseUrl) }];
      nodes.push({
        "@type": "BreadcrumbList",
        "@id": `${idOf(e)}-breadcrumb`,
        name: e.label,
        itemListElement: pages.map((p, i) => listItem(i + 1, p.name, p.url)),
      });
    }
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
    if (n["@type"] === "ItemList" || n["@type"] === "BreadcrumbList") {
      const items = n.itemListElement;
      if (!Array.isArray(items) || !items.length) problems.push(`${where}: itemListElement is missing or empty`);
      else
        (items as Json[]).forEach((it, j) => {
          if (it.position !== j + 1) problems.push(`${where}: item ${j + 1} should have position ${j + 1}`);
          if (it.item === undefined ? n["@type"] === "BreadcrumbList" && j < items.length - 1 : !/^https?:\/\//.test(String(it.item))) problems.push(`${where}: item ${j + 1} needs an absolute http(s) url`);
        });
    }
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
  /** llms-full.txt: every item gets its own heading, its full description and how it connects, instead of one line. Default false. */
  full?: boolean;
}

/** An llms.txt (llmstxt.org): the site in plain Markdown for AI assistants, one section per type. */
export function toLlmsTxt(g: Graph, o: LlmsTxtOptions = {}): string {
  const all = [...g.entities.values()];
  // The person may have no links of their own (no roles yet): they are still who the site is about.
  const person = o.person ? (g.entities.get(o.person) ?? g.unlinked?.get(o.person)) : allEntities(g).find((e) => e.type === "person");
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
      if (o.full) {
        lines.push(`### ${name}`, "");
        const headline = str(e.data?.headline);
        if (headline) lines.push(sentence(headline)!, "");
        const text = longDescription(e);
        if (text) lines.push(sentence(text)!, "");
        const links = related(g, e.id, { limit: 6 });
        if (links.length) lines.push(...links.map((r) => `- ${r.text}`), "");
        continue;
      }
      const strongest = related(g, e.id, { limit: 3 }).map((r) => r.entity.label);
      const note = [sentence(description(e)), strongest.length ? `Linked to ${strongest.join(", ")}.` : undefined].filter(Boolean).join(" ");
      lines.push(`- ${name}${note ? `: ${note}` : ""}`);
    }
    if (!o.full) lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The knowledge file's format. A minor release may add fields; changing or removing one needs a new number. */
export const KNOWLEDGE_FORMAT = 3;

export interface KnowledgeOptions {
  person?: string;
  baseUrl?: string;
  /** Site title. Default: the person's name. */
  title?: string;
  /** One-line summary. Default: the person's description. */
  summary?: string;
  /** Which types to include, in order. Default: every type, in config order. */
  types?: string[];
  /** How many related items each entity lists, with the reason as a sentence. 0 leaves them out. Default 3. */
  related?: number;
  /** Longest description, in characters; longer ones are cut with "…". Default 500. */
  maxDescription?: number;
  /** `data` fields copied onto each entity as they are (`["date", "status"]`). Default none. */
  fields?: string[];
  /** The site's own sections, added at the top level as they are. They can't replace pubba's keys. */
  extra?: Record<string, unknown>;
}

/** How every link reads, for the `links.about` note: each kind with its label. */
function linkNote(g: Graph, kinds: string[]): string {
  const named = kinds.map((k) => {
    const label = g.config.kinds?.[k]?.label;
    return label && label !== k ? `${k} (${label})` : k;
  });
  return `How the entities connect, as [from, kind, to, weight] with ids from "entities", plus what the two share when known. Weight is 0 to 1; higher is a stronger connection. Kinds: ${named.join(", ")}. Use these to answer how things relate and to suggest what to look at next.`;
}

/**
 * The graph as one JSON file for an AI to read: every entity with a short
 * description and its strongest connections in words, and every link. Publish
 * it with the site (`/pubba-knowledge.json`) so an assistant and the pages agree.
 */
export function toKnowledge(g: Graph, o: KnowledgeOptions = {}): Json {
  const max = o.maxDescription ?? 500;
  const cut = (t: string | undefined) => {
    const s = t?.replace(/\s+/g, " ").trim();
    return s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s || undefined;
  };
  const all = allEntities(g);
  const person = o.person ? (g.entities.get(o.person) ?? g.unlinked?.get(o.person)) : all.find((e) => e.type === "person");
  const typeOrder = o.types ?? [...new Set([...Object.keys(g.config.types ?? {}), ...all.map((e) => e.type)])].filter((t) => all.some((e) => e.type === t));
  const included = new Set(typeOrder);
  const entities = typeOrder.flatMap((type) => all.filter((e) => e.type === type));
  const ids = new Set(entities.map((e) => e.id));
  const links = g.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  const out: Json = {
    v: KNOWLEDGE_FORMAT,
    generator: `pubba ${VERSION}`,
    title: o.title ?? person?.label,
    summary: o.summary ?? (person ? description(person) : undefined),
    url: absolute("/", o.baseUrl),
    types: Object.fromEntries(
      typeOrder.map((t) => [t, clean({ label: g.config.types?.[t]?.label, plural: g.config.types?.[t]?.plural, count: entities.filter((e) => e.type === t).length })])
    ),
    entities: entities.map((e) =>
      clean({
        id: e.id,
        type: e.type,
        label: e.label,
        aliases: e.aliases,
        url: absolute(e.url, o.baseUrl),
        description: cut(longDescription(e)),
        ...Object.fromEntries((o.fields ?? []).map((f) => [f, e.data?.[f]])),
        related:
          (o.related ?? 3) > 0 && g.adjacent.has(e.id)
            ? related(g, e.id, { limit: o.related ?? 3, destinationsOnly: false })
                .filter((r) => included.has(r.entity.type))
                .map((r) => ({ id: r.entity.id, kind: r.reason.kind, text: r.text }))
            : undefined,
      })
    ),
    links: {
      about: linkNote(g, [...new Set(links.map((l) => l.kind))]),
      edges: links.map((l) => (l.via?.length ? [l.from, l.kind, l.to, l.weight, l.via] : [l.from, l.kind, l.to, l.weight])),
    },
  };
  for (const [k, v] of Object.entries(o.extra ?? {})) if (!(k in out)) out[k] = v;
  return clean(out);
}

export interface SitemapEntry {
  url: string;
  /** W3C date (`2026`, `2026-11` or `2026-11-15`, with an optional time) from `data.updated`, else `data.date`. */
  lastModified?: string;
}

export interface SitemapOptions {
  /** Makes relative urls absolute. Without it, only absolute urls are listed. */
  baseUrl?: string;
  /** Which types to list. Default: every destination type. */
  types?: string[];
}

const W3C_DATE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

/** A sitemap entry for every entity with a page on the site, for sites that build their sitemap from content. */
export function toSitemapEntries(g: Graph, o: SitemapOptions = {}): SitemapEntry[] {
  const site = (() => {
    try {
      return o.baseUrl ? new URL(o.baseUrl).origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const e of allEntities(g)) {
    if (o.types ? !o.types.includes(e.type) : !isDestination(g, e)) continue;
    const url = e.url && (o.baseUrl || /^https?:\/\//.test(e.url)) ? absolute(e.url, o.baseUrl) : undefined;
    if (!url || (site && !url.startsWith(`${site}/`)) || seen.has(url)) continue;
    seen.add(url);
    const date = [e.data?.updated, e.data?.date].map((d) => (typeof d === "string" ? d.trim() : undefined)).find((d) => d && W3C_DATE.test(d));
    out.push(date ? { url, lastModified: date } : { url });
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Sitemap entries as a sitemap.xml (sitemaps.org). */
export function toSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => `  <url>\n    <loc>${escapeXml(e.url)}</loc>\n${e.lastModified ? `    <lastmod>${e.lastModified}</lastmod>\n` : ""}  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>\n`;
}
