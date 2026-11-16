import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWLEDGE_FORMAT, toJsonLd, toKnowledge, toLlmsTxt, toSitemapEntries, toSitemapXml, validateJsonLd } from "../src/exports/index.ts";
import { buildGraph } from "../src/graph.ts";
import { VERSION } from "../src/version.ts";
import { examplePubba, portfolio } from "./fixtures.ts";

const g = examplePubba().graph;

test("JSON-LD: a Person with knowsAbout and worksFor, works linked by creator, and valid", () => {
  const doc = toJsonLd(g, { baseUrl: "https://nimali.example.com" });
  const nodes = doc["@graph"] as Record<string, any>[];
  const person = nodes.find((n) => n["@type"] === "Person")!;
  assert.equal(person.name, "Nimali Perera");
  assert.ok(person.knowsAbout.includes("Flutter"));
  assert.deepEqual(person.worksFor, [{ "@type": "Organization", name: "Lumen Labs" }]);
  assert.equal(person.email, undefined, "email only when asked");
  const wallet = nodes.find((n) => n.name === "Kiri Wallet")!;
  assert.equal(wallet["@type"], "SoftwareApplication");
  assert.equal(wallet.creator["@id"], person["@id"]);
  assert.match(wallet.keywords, /Flutter/);
  assert.equal(wallet.operatingSystem, "Mobile");
  assert.ok(nodes.some((n) => n["@type"] === "CreativeWork"));
  assert.ok(!nodes.some((n) => n.name === "Skyforge Saga"), "games are left out by default");
  assert.deepEqual(validateJsonLd(doc), []);
});

test("JSON-LD validation catches what breaks it", () => {
  const problems = validateJsonLd({ "@context": "http://schema.org", "@graph": [{ "@type": "Person", "@id": "#a", url: "/me" }, { name: "x", "@id": "#a", creator: { "@id": "#b" } }] });
  assert.equal(problems.length, 6, problems.join("\n"));
});

test("llms.txt: title, summary and a section per destination type with links", () => {
  const txt = toLlmsTxt(g);
  assert.match(txt, /^# Nimali Perera\n\n> A mobile and web developer/);
  assert.match(txt, /\n## Projects\n\n- \[Kiri Wallet\]\(https:\/\/nimali\.example\.com\/projects\/kiri-wallet\): A mobile wallet for everyday payments\. Linked to /);
  assert.match(txt, /\n## Skills\n/);
  assert.ok(!/## Topics|## Platforms/.test(txt));
});

test("0.1.3: curated knowsAbout, one page's subset, headline plus full description, ids kept on the site", () => {
  const input = {
    ...portfolio,
    projects: portfolio.projects.map((p) => (p.slug === "kiri-wallet" ? { ...p, fullDescription: "The whole story of Kiri Wallet, at length." } : p)),
    creative: (portfolio.creative ?? []).map((c) => (c.id === "offline-first" ? { ...c, url: "https://medium.com/@nimali/offline-first" } : c)),
  };
  const graph = examplePubba(undefined, input).graph;
  const doc = toJsonLd(graph, { baseUrl: "https://nimali.example.com", knowsAbout: ["Mobile architecture", "Flutter"] });
  const nodes = doc["@graph"] as Record<string, any>[];
  assert.deepEqual(nodes.find((n) => n["@type"] === "Person")!.knowsAbout, ["Mobile architecture", "Flutter"]);
  const wallet = nodes.find((n) => n.name === "Kiri Wallet")!;
  assert.equal(wallet.headline, "A mobile wallet for everyday payments");
  assert.equal(wallet.description, "The whole story of Kiri Wallet, at length.");
  const article = nodes.find((n) => String(n["@id"]).endsWith("#creative:offline-first"))!;
  assert.equal(article.url, "https://medium.com/@nimali/offline-first");
  assert.ok(article["@id"].startsWith("https://nimali.example.com"), article["@id"]);
  assert.ok(wallet["@id"].startsWith("https://nimali.example.com/projects/kiri-wallet"));
  assert.deepEqual(validateJsonLd(doc), []);

  const page = toJsonLd(graph, { baseUrl: "https://nimali.example.com", include: ["project:kiri-wallet"] });
  assert.deepEqual((page["@graph"] as Record<string, any>[]).map((n) => n["@type"]), ["Person", "SoftwareApplication"]);
  assert.match(toLlmsTxt(graph), /Kiri Wallet\]\([^)]+\): A mobile wallet for everyday payments\./, "llms.txt keeps the short line");
});

test("0.1.4: a person with no links of their own is still in the JSON-LD and llms.txt", () => {
  const lonely = examplePubba(undefined, { ...portfolio, roles: [], projects: portfolio.projects.map((p) => ({ ...p, tags: [] })) });
  assert.ok(lonely.graph.unlinked.has("me"));
  const nodes = toJsonLd(lonely.graph, { knowsAbout: ["Mobile architecture"] })["@graph"] as Record<string, any>[];
  const person = nodes.find((n) => n["@type"] === "Person");
  assert.equal(person?.name, "Nimali Perera");
  assert.deepEqual(person?.knowsAbout, ["Mobile architecture"]);
  assert.ok(nodes.filter((n) => n["@type"] !== "Person").every((n) => n.creator?.["@id"] === person!["@id"]));
  assert.match(toLlmsTxt(lonely.graph), /^# Nimali Perera/);
});

test("0.1.5: apps carry the two properties Google's Software App result needs; tags stay out of operatingSystem", () => {
  const input = {
    ...portfolio,
    projects: portfolio.projects.map((p) =>
      p.slug === "synthpad" ? { ...p, category: "Web, Backend" } : p.slug === "tidepool" ? { ...p, applicationCategory: "DeveloperApplication" } : p
    ),
  };
  const nodes = toJsonLd(examplePubba(undefined, input).graph, { baseUrl: "https://nimali.example.com" })["@graph"] as Record<string, any>[];
  const apps = nodes.filter((n) => n["@type"] === "SoftwareApplication");
  assert.ok(apps.length > 0 && apps.every((n) => n.applicationCategory && n.operatingSystem), "every app has both");
  const by = (name: string) => apps.find((n) => n.name === name)!;
  assert.equal(by("Kiri Wallet").applicationCategory, "FinanceApplication");
  assert.equal(by("StudyBuddy Planner").applicationCategory, "EducationalApplication");
  assert.equal(by("Synthpad").applicationCategory, "MultimediaApplication");
  assert.equal(by("Tidepool Dashboard").applicationCategory, "DeveloperApplication", "a project's own category wins");
  assert.equal(by("Synthpad").operatingSystem, "Web", "not Backend, not the founded tag");
  assert.equal(by("StudyBuddy Planner").operatingSystem, "Mobile");
  assert.ok(!apps.some((n) => /founded/i.test(n.operatingSystem)));
});

test("1.1: the knowledge file: every entity in config order, connections in words, links as tuples", () => {
  const k = toKnowledge(g, { baseUrl: "https://nimali.example.com", fields: ["date"] }) as Record<string, any>;
  assert.equal(k.v, KNOWLEDGE_FORMAT);
  assert.equal(k.generator, `pubba ${VERSION}`);
  assert.equal(k.title, "Nimali Perera");
  assert.equal(k.url, "https://nimali.example.com/");
  assert.equal(k.entities.length, g.entities.size + g.unlinked.size, "linked and unlinked entities alike");
  assert.deepEqual(Object.keys(k.types).slice(0, 3), ["person", "project", "tech"]);
  assert.equal(k.types.project.count, k.entities.filter((e: any) => e.type === "project").length);
  const wallet = k.entities.find((e: any) => e.id === "project:kiri-wallet");
  assert.equal(wallet.url, "https://nimali.example.com/projects/kiri-wallet");
  assert.equal(wallet.date, "2024");
  assert.equal(wallet.related.length, 3);
  assert.match(wallet.related[0].text, /Kiri Merchant/);
  const sameStack = k.links.edges.find((e: unknown[]) => e[1] === "same-stack");
  assert.equal(sameStack.length, 5, "[from, kind, to, weight, via]");
  assert.ok(typeof sameStack[3] === "number" && Array.isArray(sameStack[4]));
  assert.ok(k.links.edges.every((e: unknown[]) => e.length === 4 || e.length === 5));
  assert.match(k.links.about, /\[from, kind, to, weight\]/);
  assert.match(k.links.about, /same-stack/);
});

test("1.1: the knowledge file takes the site's own sections, never over its own keys; types, related and cut", () => {
  const k = toKnowledge(g, { types: ["project"], related: 0, maxDescription: 20, extra: { faq: ["Where?"], v: 99, entities: [] } }) as Record<string, any>;
  assert.deepEqual(k.faq, ["Where?"]);
  assert.equal(k.v, KNOWLEDGE_FORMAT);
  assert.ok(k.entities.length > 0 && k.entities.every((e: any) => e.type === "project" && e.related === undefined));
  assert.ok(k.entities.every((e: any) => !e.description || e.description.length <= 20));
  assert.ok(k.entities.some((e: any) => e.description?.endsWith("…")));
  assert.ok(k.links.edges.every((e: string[]) => String(e[0]).startsWith("project:") && String(e[2]).startsWith("project:")), "only links between included entities");
  assert.equal(k.url, undefined, "no url without a base");
});

test("1.1: llms-full.txt gives every item a heading, its full description and its connections", () => {
  const graph = examplePubba(undefined, {
    ...portfolio,
    projects: portfolio.projects.map((p) => (p.slug === "kiri-wallet" ? { ...p, fullDescription: "The whole story of Kiri Wallet, at length." } : p)),
  }).graph;
  const full = toLlmsTxt(graph, { full: true });
  assert.match(full, /\n## Projects\n\n### \[Kiri Wallet\]\(https:\/\/nimali\.example\.com\/projects\/kiri-wallet\)\n\nA mobile wallet for everyday payments\.\n\nThe whole story of Kiri Wallet, at length\.\n\n- Kiri Merchant is built on the same stack/);
  assert.ok(!/^- \[Kiri Wallet\]/m.test(full), "no one-line entries");
  assert.ok(full.endsWith("\n") && !full.endsWith("\n\n"));
});

test("1.1: JSON-LD ItemList, BreadcrumbList and hasOccupation, each only when asked", () => {
  const base = "https://nimali.example.com";
  const plain = toJsonLd(g, { baseUrl: base })["@graph"] as Record<string, any>[];
  assert.ok(!plain.some((n) => n["@type"] === "ItemList" || n["@type"] === "BreadcrumbList"));
  assert.equal(plain.find((n) => n["@type"] === "Person")!.hasOccupation, undefined);

  const doc = toJsonLd(g, { baseUrl: base, itemList: { type: "project", url: "/projects" }, breadcrumb: "project:kiri-wallet", occupations: true });
  const nodes = doc["@graph"] as Record<string, any>[];
  const list = nodes.find((n) => n["@type"] === "ItemList")!;
  assert.equal(list.name, "Projects");
  assert.equal(list.url, `${base}/projects`);
  assert.equal(list.numberOfItems, list.itemListElement.length);
  assert.deepEqual(list.itemListElement[0], { "@type": "ListItem", position: 1, name: "Kiri Wallet", item: `${base}/projects/kiri-wallet` });
  const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList")!;
  assert.deepEqual(
    crumbs.itemListElement.map((i: any) => [i.position, i.name, i.item]),
    [
      [1, "Home", `${base}/`],
      [2, "Kiri Wallet", `${base}/projects/kiri-wallet`],
    ]
  );
  const jobs = nodes.find((n) => n["@type"] === "Person")!.hasOccupation;
  assert.equal(jobs.length, 3, "every role, past ones too");
  assert.equal(jobs[0]["@type"], "Occupation");
  assert.match(jobs[0].skills, /Flutter/);
  assert.deepEqual(validateJsonLd(doc), []);

  const parents = toJsonLd(g, { baseUrl: base, breadcrumb: { id: "project:kiri-wallet", parents: [{ name: "Home", url: "/" }, { name: "Projects", url: "/projects" }] } });
  assert.deepEqual(((parents["@graph"] as any[]).find((n) => n["@type"] === "BreadcrumbList").itemListElement as any[]).map((i) => i.name), ["Home", "Projects", "Kiri Wallet"]);
  assert.ok(!(toJsonLd(g, { breadcrumb: "nope" })["@graph"] as any[]).some((n) => n["@type"] === "BreadcrumbList"), "an unknown id adds nothing");
});

test("1.1: JSON-LD validation checks list positions and urls", () => {
  const problems = validateJsonLd({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "ItemList", name: "Projects", itemListElement: [{ "@type": "ListItem", position: 2, name: "A", item: "/a" }] },
      { "@type": "BreadcrumbList", name: "B", itemListElement: [{ position: 1, name: "Home" }, { position: 2, name: "B" }] },
      { "@type": "ItemList", name: "Empty", itemListElement: [] },
    ],
  });
  assert.deepEqual(problems, [
    "@graph[0] (Projects): item 1 should have position 1",
    "@graph[0] (Projects): item 1 needs an absolute http(s) url",
    "@graph[1] (B): item 1 needs an absolute http(s) url",
    "@graph[2] (Empty): itemListElement is missing or empty",
  ]);
});

test("1.1: sitemap entries: the site's own pages once each, with W3C dates", () => {
  const graph = buildGraph({
    entities: [
      { id: "a", type: "page", label: "A", url: "/a", data: { date: "2026-11-15" } },
      { id: "b", type: "page", label: "B", url: "https://site.example/b?x=1&y=2", data: { updated: "2026-11", date: "2020" } },
      { id: "c", type: "page", label: "C", url: "https://elsewhere.example/c" },
      { id: "d", type: "page", label: "D", url: "/a" },
      { id: "e", type: "page", label: "E", url: "/e", data: { date: "15 Nov 2026" } },
      { id: "f", type: "page", label: "F" },
      { id: "t", type: "tag", label: "T", url: "/t" },
    ],
    links: [
      { from: "a", kind: "tagged", to: "t" },
      { from: "b", kind: "tagged", to: "t" },
    ],
  }, { types: { tag: { destination: false } } });
  assert.deepEqual(toSitemapEntries(graph, { baseUrl: "https://site.example" }), [
    { url: "https://site.example/a", lastModified: "2026-11-15" },
    { url: "https://site.example/b?x=1&y=2", lastModified: "2026-11" },
    { url: "https://site.example/e" },
  ]);
  assert.deepEqual(toSitemapEntries(graph).map((e) => e.url), ["https://site.example/b?x=1&y=2", "https://elsewhere.example/c"], "without a base, only absolute urls");
  assert.deepEqual(toSitemapEntries(graph, { baseUrl: "https://site.example", types: ["tag"] }), [{ url: "https://site.example/t" }]);
  const xml = toSitemapXml(toSitemapEntries(graph, { baseUrl: "https://site.example" }));
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
  assert.match(xml, /<loc>https:\/\/site\.example\/b\?x=1&amp;y=2<\/loc>\n    <lastmod>2026-11<\/lastmod>/);
  assert.equal(toSitemapXml([]), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
});
