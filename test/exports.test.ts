import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonLd, toLlmsTxt, validateJsonLd } from "../src/exports/index.ts";
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
