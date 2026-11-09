import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonLd, toLlmsTxt, validateJsonLd } from "../src/exports/index.ts";
import { examplePubba } from "./fixtures.ts";

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
