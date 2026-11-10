import { lowerKey, mentions } from "../text.ts";
import type { Dataset, Entity, Link, PubbaConfig, Topic } from "../types.ts";

/*
 * The portfolio preset: the types, link kinds, weights, rules and sentences
 * a developer or designer portfolio needs, plus `fromPortfolio`, which turns
 * plain portfolio content into entities and links.
 *
 *   person    worked-as    role       their roles
 *   person    founded      project    ventures tagged "founded"
 *   project   built-with   tech       the project's technologies
 *   project   shipped-in   market     the countries its text names
 *   project   made-at      role       the role whose story names it
 *   project   runs-on      area       its platforms (iOS, Web…) and tags
 *   project   same-stack   project    two or more core technologies shared
 *   tech      used-at      role       the role whose story names it
 *   tech      used-with    tech       used together in two or more projects
 *   game      runs-on      area       PS5, PC, mobile; channels on Twitch…
 *   game      same-series  game       God of War → God of War Ragnarök
 *   creative  runs-on      area       YouTube, Medium, Instagram…
 *   any       about        topic      telecom, fintech, music… in its text
 *   any       mentions     any        its text names another entity
 *
 * Ids: me, project:<slug>, tech:<name>, role:<index>, market:<code>,
 * area:<key>, game:<id>, creative:<id>, topic:<key>.
 */

export type Pronoun = "he" | "she" | "they";

export interface PortfolioOptions {
  /** How sentences refer to the person. Default "they". */
  pronoun?: Pronoun;
  /** Names containing this never match a query (the person's own pages carry it). Usually their first name. */
  owner?: string;
  /**
   * Match exactly as the original portfolio site did: typos on 4-letter words,
   * no distinct-word, partial-name or precise matching. Default false (stricter and wider,
   * and measurably more accurate).
   */
  legacyMatching?: boolean;
}

/** How much a skill says by its category: languages and frameworks define a stack, tools are on everything. */
export const SKILL_WEIGHT: Record<string, number> = { languages: 1, frameworks: 1, platforms: 0.7, design: 0.4, tools: 0.4 };
export const skillWeight = (category?: string): number => SKILL_WEIGHT[lowerKey(String(category ?? ""))] ?? 0.7;

/** Subjects a text can be about, wherever it appears. */
export const PORTFOLIO_TOPICS: Topic[] = [
  { key: "telecom", label: "Telecom", pattern: /\btelecom|\bsim\b|esim|roaming|\bmobile operator|\bprepaid|\brecharge|data bundle|\bmobile plans?\b/i },
  { key: "fintech", label: "Fintech", pattern: /fintech|payment|\bpay later|buy[- ]now|\bwallet|\bbanking|\bqr pay/i },
  { key: "delivery", label: "Delivery & logistics", pattern: /deliver|logistic|courier|\bdriver|\bmerchant|last[- ]mile/i },
  { key: "education", label: "Education", pattern: /\bstudent|\beducat|\be-?learning|\bcourse|\buniversit|\bschool/i },
  { key: "research", label: "Research", pattern: /research|publication|conference|\br&d\b/i },
  { key: "ai", label: "AI", pattern: /\bai\b|artificial intelligence|machine learning|\bllm|\bgemini|\bgpt/i },
  { key: "music", label: "Music", pattern: /\bmusic|\bsynth|\bsing(er|ing)\b|\bsongs?\b|\bviolin/i },
  { key: "visual-art", label: "Visual art", pattern: /\bart\b|\bcinematic|\bvisual|\bphotograph|\bvideo/i },
  { key: "productivity", label: "Productivity", pattern: /\bcalculat|\bproductiv|\bplanner|\bmeeting|\bschedul/i },
];

export const AREA_LABEL: Record<string, string> = {
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

const WORDS: Record<Pronoun, { they: string; their: string; plays: string }> = {
  he: { they: "he", their: "his", plays: "plays" },
  she: { they: "she", their: "her", plays: "plays" },
  they: { they: "they", their: "their", plays: "play" },
};

/** The preset's sentences, one per link kind, in the person's pronoun. */
export function portfolioTemplates(pronoun: Pronoun = "they"): NonNullable<PubbaConfig["templates"]> {
  const { they, their, plays } = WORDS[pronoun];
  return {
    section: "{item} is worth a look.",
    "section.game": `{item} is one ${they} ${plays}.`,
    "same-stack": "{item} is built on the same stack as {other}[ ({via})].",
    "same-series": "{item} is from the same series as {other}.",
    "built-with": { out: "{item} is built with {other}.", in: "{item} is part of {other}'s stack." },
    "shipped-in": { out: "{item} shipped in {other} too.", in: "{item} is where {other} shipped." },
    "made-at": { cases: [{ item: "role", text: `As {item}, ${they} built {other}.` }], default: `{item} is what ${they} built as {other}.` },
    "used-with": "{item} goes with {other}[, as in {via}].",
    "used-at": { cases: [{ item: "role", text: `As {item}, ${they} worked with {other}.` }], default: `{item} was part of ${their} work as {other}.` },
    about: "{item} is about {otherLower} too.",
    "runs-on": "{item} is on {other} as well.",
    "worked-as": `{item} is one of ${their} roles.`,
    founded: `{item} is one of ${their} own ventures.`,
    mentions: {
      cases: [
        { item: "role", other: "market", text: `As {item}, ${they} shipped to {other}.` },
        { item: "market", other: "role", text: `{item} is where ${they} shipped as {other}.` },
      ],
      out: "{item} mentions {other}.",
      in: "{other} mentions {item}.",
    },
  };
}

/** The whole portfolio config. Layer site changes over it with `mergeConfig`. */
export function portfolioConfig({ pronoun = "they", owner, legacyMatching = false }: PortfolioOptions = {}): PubbaConfig {
  const item = { tier: 2, minLength: 3, minWordsLength: 4 };
  return {
    types: {
      person: { label: "Person", plural: "People", destination: false, match: { skip: true } },
      project: { label: "Project", plural: "Projects", match: { tier: 1, firstWord: true }, similar: ["same-stack"] },
      tech: { label: "Skill", plural: "Skills", match: { tier: 3, mode: "phrase" } },
      role: { label: "Role", plural: "Experience", match: { ...item, firstWord: true } },
      market: { label: "Market", plural: "Markets", match: item },
      game: { label: "Game", plural: "Games", match: item },
      creative: { label: "Creative work", plural: "Creative work", match: item },
      area: { label: "Platform", plural: "Platforms", destination: false, match: { skip: true } },
      topic: { label: "Topic", plural: "Topics", destination: false, match: { skip: true } },
    },
    kinds: {
      "same-stack": { label: "same stack as", pull: 1 },
      "same-series": { label: "same series as", pull: 1 },
      "built-with": { label: "built with", pull: 0.9, weightFrom: "to", weight: 0.7 },
      "shipped-in": { label: "shipped in", pull: 0.9, weight: 1 },
      "made-at": { label: "made at", pull: 0.8, weight: 1 },
      "used-with": { label: "used with", pull: 0.8 },
      "used-at": { label: "used at", pull: 0.6, weightFrom: "from", weight: 0.7 },
      about: { label: "about", pull: 0.75, weight: 0.7 },
      "runs-on": { label: "runs on", pull: 0.55, weight: 0.6 },
      "worked-as": { label: "worked as", pull: 0.7, weight: 1 },
      founded: { label: "founded", pull: 0.8, weight: 1 },
      mentions: { label: "mentions", pull: 0.5, weight: 0.5 },
    },
    rules: [
      { type: "named-in", id: "made-at", kind: "made-at", named: ["project"], in: ["role"], direction: "named-to-text", weight: 1 },
      { type: "named-in", id: "used-at", kind: "used-at", named: ["tech"], in: ["role"], direction: "named-to-text", weightFrom: "named" },
      { type: "label-prefix", kind: "same-series", among: "game", weight: 1 },
      { type: "shared", kind: "same-stack", among: "project", through: ["built-with"], minWeight: 1, min: 2, base: 0.5 },
      { type: "co-occur", kind: "used-with", among: "tech", through: ["built-with"], minWeight: 0.7, min: 2, saturate: 4 },
      { type: "topics", kind: "about", topics: PORTFOLIO_TOPICS, weight: 0.7 },
      { type: "named-in", kind: "mentions", named: ["project", "tech", "market"], direction: "text-to-named", weight: 0.5, minNameLength: { tech: 4 } },
    ],
    next: {
      recency: 0.6,
      secondStep: 0.4,
      sections: { projects: "project", skills: "tech", reach: "market", experience: "role", games: "game", creative: "creative" },
    },
    match: {
      ...(owner ? { ignore: [owner] } : {}),
      // The words the preset puts in page labels ("TikTok channel") say what a page is, not which one.
      ...(legacyMatching ? {} : { typoMinLength: 5, distinctWords: true, partialWords: true, precise: true, notDistinct: Object.values(KIND_WORD) }),
    },
    templates: portfolioTemplates(pronoun),
  };
}

export interface PortfolioInput {
  person: { name: string; short?: string; url?: string; jobTitle?: string; image?: string; email?: string; sameAs?: string[]; description?: string };
  roles: { title: string; company: string; location?: string; start?: string; end?: string; points: string[]; url?: string; aliases?: string[] }[];
  projects: {
    slug: string;
    title: string;
    subtitle?: string;
    description?: string;
    fullDescription?: string;
    /** Platforms, comma separated ("Mobile, Web"). */
    category?: string;
    tags?: string[];
    technologies: string[];
    url?: string;
    image?: string;
    date?: string;
    aliases?: string[];
    /** Market codes it shipped in, on top of the ones its text names. */
    markets?: string[];
    /** Google's app type for JSON-LD ("FinanceApplication"). Default: from the project's topics, see APP_CATEGORY. */
    applicationCategory?: string;
  }[];
  skills: { name: string; category?: string; aliases?: string[] }[];
  markets?: { code: string; name: string; aliases?: string[] }[];
  games?: { id: string; title: string; platform: string; genre?: string; note?: string; url?: string; aliases?: string[] }[];
  creative?: { id: string; title: string; platform: string; kind: string; description?: string; url?: string; aliases?: string[] }[];
  /** Labels for platform and tag keys, over the preset's. */
  areaLabels?: Record<string, string>;
}

const NOT_A_NAME = new Set(["the", "app", "and", "for", "web", "android", "ios", "my", "student", "live", "squad"]);

/** The word a text would use for a project: "Odoo" for "Odoo Merchant", "YOOZ". */
export function callName(title: string): string | null {
  return title.split(/[\s(),]+/).find((w) => w.length > 3 && !NOT_A_NAME.has(lowerKey(w))) ?? null;
}

/** A role reads by its title alone in a sentence ("Software Engineer II"). */
export const roleShort = (title: string): string => title.replace(/\s+[—–-]\s+.*$/, "");

/** Category words that say what a project is, not what it runs on: kept out of `operatingSystem`. */
const NOT_A_PLATFORM = new Set(["backend", "frontend", "api", "server", "fullstack", "full stack", "cms", "library"]);
const platformsOf = (category?: string) =>
  (category ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !NOT_A_PLATFORM.has(lowerKey(s)));

/**
 * Google's app types (its Software App rich result needs one) for the preset's
 * topics, in order of preference; projects about none of them are utilities.
 */
export const APP_CATEGORY: [topic: string, category: string][] = [
  ["fintech", "FinanceApplication"],
  ["education", "EducationalApplication"],
  ["telecom", "CommunicationApplication"],
  ["music", "MultimediaApplication"],
  ["visual-art", "DesignApplication"],
  ["delivery", "BusinessApplication"],
  ["productivity", "BusinessApplication"],
  ["research", "ReferenceApplication"],
];

function appCategory(text: string): string {
  for (const [key, category] of APP_CATEGORY) {
    const topic = PORTFOLIO_TOPICS.find((t) => t.key === key);
    const re = topic && (typeof topic.pattern === "string" ? new RegExp(topic.pattern, "i") : topic.pattern);
    if (re?.test(text)) return category;
  }
  return "UtilitiesApplication";
}

const KIND_WORD: Record<string, string> = { page: "page", channel: "channel", writing: "article", art: "piece" };

/** Plain portfolio content as entities and links, ready for `createPubba` with `portfolioConfig`. */
export function fromPortfolio(input: PortfolioInput): Dataset {
  const areaLabel = { ...AREA_LABEL, ...input.areaLabels };
  const entities: Entity[] = [];
  const links: Link[] = [];
  const seen = new Map<string, Entity>();
  const add = (e: Entity) => {
    const had = seen.get(e.id);
    if (had) return had;
    seen.set(e.id, e);
    entities.push(e);
    return e;
  };
  const area = (k: string, label = areaLabel[lowerKey(k)] ?? k) => add({ id: `area:${lowerKey(k)}`, type: "area", label }).id;
  const skills = new Map(input.skills.map((s) => [lowerKey(s.name), s]));
  const owner = input.person.short ?? input.person.name.split(" ")[0] ?? input.person.name;

  const p = input.person;
  add({ id: "me", type: "person", label: p.name, short: owner, ...(p.url ? { url: p.url } : {}), data: { jobTitle: p.jobTitle, image: p.image, email: p.email, sameAs: p.sameAs, description: p.description } });
  input.roles.forEach((r, i) =>
    add({
      id: `role:${i}`,
      type: "role",
      label: `${r.title}, ${r.company}`,
      short: roleShort(r.title),
      // The company names only its latest role (roles come newest first), so a promotion doesn't make it ambiguous.
      aliases: [...(input.roles.findIndex((x) => x.company === r.company) === i ? [r.company] : []), roleShort(r.title), ...(r.aliases ?? [])],
      text: `${r.title} ${r.points.join(" ")}`,
      ...(r.url ? { url: r.url } : {}),
      data: { title: r.title, company: r.company, location: r.location, start: r.start, end: r.end },
    })
  );
  for (const pr of input.projects) {
    const call = callName(pr.title);
    add({
      id: `project:${pr.slug}`,
      type: "project",
      label: pr.title,
      text: `${pr.title} ${pr.subtitle ?? ""} ${pr.description ?? ""} ${pr.fullDescription ?? ""}`,
      mentionAs: call ? [call] : false,
      ...(pr.aliases ? { aliases: pr.aliases } : {}),
      ...(pr.url ? { url: pr.url } : {}),
      data: {
        description: pr.subtitle || pr.description,
        headline: pr.subtitle || undefined,
        longDescription: pr.fullDescription || pr.description || undefined,
        category: pr.category,
        operatingSystem: platformsOf(pr.category).join(", ") || undefined,
        applicationCategory: pr.applicationCategory ?? appCategory(`${pr.title} ${pr.subtitle ?? ""} ${pr.description ?? ""} ${pr.fullDescription ?? ""}`),
        image: pr.image,
        date: pr.date,
      },
    });
  }
  for (const s of input.skills) add({ id: `tech:${s.name}`, type: "tech", label: s.name, weight: skillWeight(s.category), ...(s.aliases ? { aliases: s.aliases } : {}), data: { category: s.category } });
  for (const g of input.games ?? []) add({ id: `game:${g.id}`, type: "game", label: g.title, text: `${g.title} ${g.genre ?? ""} ${g.note ?? ""}`, ...(g.aliases ? { aliases: g.aliases } : {}), ...(g.url ? { url: g.url } : {}), data: { platform: g.platform, genre: g.genre } });
  for (const c of input.creative ?? []) {
    const own = mentions(c.title, owner);
    add({
      id: `creative:${c.id}`,
      type: "creative",
      label: own ? `${areaLabel[lowerKey(c.platform)] ?? c.platform} ${KIND_WORD[c.kind] ?? c.kind}` : c.title,
      text: `${c.title} ${c.description ?? ""}`,
      ...(c.aliases ? { aliases: c.aliases } : {}),
      ...(c.url ? { url: c.url } : {}),
      data: { platform: c.platform, kind: c.kind, description: c.description },
    });
  }
  const marketNames = (m: NonNullable<PortfolioInput["markets"]>[number]) => [m.name, ...(m.aliases ?? [])];
  const market = (m: NonNullable<PortfolioInput["markets"]>[number]) =>
    add({ id: `market:${m.code}`, type: "market", label: m.name, mentionAs: marketNames(m), ...(m.aliases ? { aliases: m.aliases } : {}) }).id;

  input.roles.forEach((_, i) => links.push({ from: "me", kind: "worked-as", to: `role:${i}` }));
  for (const pr of input.projects) {
    const pid = `project:${pr.slug}`;
    if ((pr.tags ?? []).some((t) => lowerKey(t) === "founded")) links.push({ from: "me", kind: "founded", to: pid });
    for (const name of pr.technologies) {
      const s = skills.get(lowerKey(name));
      const t = add({ id: `tech:${s?.name ?? name}`, type: "tech", label: s?.name ?? name, weight: skillWeight(s?.category) });
      links.push({ from: pid, kind: "built-with", to: t.id });
    }
    const haystack = `${pr.category ?? ""} ${pr.subtitle ?? ""} ${pr.description ?? ""} ${pr.fullDescription ?? ""}`;
    for (const m of input.markets ?? []) {
      if ((pr.markets ?? []).includes(m.code) || marketNames(m).some((n) => mentions(haystack, n))) links.push({ from: pid, kind: "shipped-in", to: market(m) });
    }
    for (const c of (pr.category ?? "").split(",").map((s) => s.trim()).filter(Boolean)) links.push({ from: pid, kind: "runs-on", to: area(c, c) });
    for (const t of pr.tags ?? []) links.push({ from: pid, kind: "runs-on", to: area(t) });
  }
  for (const g of input.games ?? []) links.push({ from: `game:${g.id}`, kind: "runs-on", to: area(g.platform) });
  for (const c of input.creative ?? []) links.push({ from: `creative:${c.id}`, kind: "runs-on", to: area(c.platform), weight: 0.5 });
  // The other markets in the order texts first name them, so equal scores rank as they always have.
  const texts = entities.filter((e) => e.text).map((e) => e.text!);
  const firstNamed = (m: NonNullable<PortfolioInput["markets"]>[number]) => {
    const i = texts.findIndex((t) => marketNames(m).some((n) => mentions(t, n)));
    return i < 0 ? Infinity : i;
  };
  [...(input.markets ?? [])]
    .map((m, i) => ({ m, i, at: firstNamed(m) }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .forEach(({ m }) => market(m));
  return { entities, links };
}
