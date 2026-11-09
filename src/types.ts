/** One thing on the site: a project, a skill, a role, a product, a course, a page. */
export interface Entity {
  /** Unique id, conventionally `type:key` ("project:odoo-driver"). */
  id: string;
  /** The entity's type: a key of `config.types`. */
  type: string;
  /** Its full name. */
  label: string;
  /** How it reads inside a sentence ("Software Engineer II" for a role labelled with its company). */
  short?: string;
  /** Other names people type for it: short forms, abbreviations, old names. */
  aliases?: string[];
  /** Its own words. Derived-link rules (topics, mentions) read this. */
  text?: string;
  url?: string;
  /** 0 to 1: how much a link to it says. Common tools weigh less, so they never make two items look alike. */
  weight?: number;
  /** The names that count when another entity's text mentions it. Defaults to the label; `false` for never. */
  mentionAs?: string[] | false;
  /** Anything else the site wants to carry along (exports read `description`, `image`, `date`…). */
  data?: Record<string, unknown>;
}

/** A typed link between two entities, as the site writes it. */
export interface Link {
  from: string;
  kind: string;
  to: string;
  /** 0 to 1. Defaults come from the kind config, then from an end entity's weight. */
  weight?: number;
  /** What the two ends share ("Flutter", "Dart" for same-stack). */
  via?: string[];
}

/** A link in the built graph: weight resolved, and the rule that made it when it was derived. */
export interface GraphLink {
  from: string;
  kind: string;
  to: string;
  weight: number;
  via?: string[];
  /** The rule id for derived links. */
  rule?: string;
}

export interface Dataset {
  entities: Entity[];
  links?: Link[];
}

export interface TypeConfig {
  /** Shown to people ("Project"). */
  label?: string;
  /** Plural, for lists and exports ("Projects"). */
  plural?: string;
  /** Worth suggesting as a place to go. Platforms and topics usually only carry the light. Default true. */
  destination?: boolean;
  /** How typed queries match this type. */
  match?: TypeMatchConfig;
  /** Link kinds that answer "anything like X?" for this type. Defaults to every kind. */
  similar?: string[];
}

export interface TypeMatchConfig {
  /** Lower tiers are tried first; the first tier with a hit wins. Default 1. */
  tier?: number;
  /** `title`: the whole name, or all its significant words, anywhere in the query. `phrase`: the name as a fuzzy phrase, longest names first. Default `title`. */
  mode?: "title" | "phrase";
  /** A significant first word alone is enough ("Arimac" for "Arimac Digital"). Default false. */
  firstWord?: boolean;
  /** Names shorter than this never match. Default 0. */
  minLength?: number;
  /** With every significant word hit, their letters together must be longer than this. Default 0. */
  minWordsLength?: number;
  /** Never matched from a query. */
  skip?: boolean;
}

export interface KindConfig {
  /** Shown to people ("built with"). Defaults to the kind with dashes as spaces. */
  label?: string;
  /** How strongly this kind pulls a visitor onward, 0 to 1. Default 0.5. */
  pull?: number;
  /** Default weight for links of this kind. */
  weight?: number;
  /** Take the weight from an end entity's `weight` when the link has none ("built-with" weighs as much as the tool). */
  weightFrom?: "from" | "to";
}

/** Two items share two or more targets of a kind: "same stack" when two projects share core skills. */
export interface SharedRule {
  type: "shared";
  id?: string;
  /** In `extraRules`: run before the rule with this id (a rule's id defaults to its kind), so it wins the pair. */
  before?: string;
  kind: string;
  /** The entity type compared, pairwise. */
  among: string;
  /** The link kinds followed out of each item. */
  through: string[];
  /** Only targets this heavy count ("core" skills). Default 0. */
  minWeight?: number;
  /** Shared targets needed. Default 2. */
  min?: number;
  /** Weight = base + (1 - base) × shared/union. Default 0.5. */
  base?: number;
}

/** Two targets used together by two or more items: "used with" for two tools in the same projects. */
export interface CoOccurRule {
  type: "co-occur";
  id?: string;
  /** In `extraRules`: run before the rule with this id (a rule's id defaults to its kind), so it wins the pair. */
  before?: string;
  kind: string;
  /** The entity type of the targets that get linked. */
  among: string;
  /** The link kinds that lead from an item to a target. */
  through: string[];
  minWeight?: number;
  /** Items needed in common. Default 2. */
  min?: number;
  /** Weight = min(items / saturate, 1). Default 4. */
  saturate?: number;
}

/** One label starts with another's plus a space: "God of War" → "God of War Ragnarök". */
export interface LabelPrefixRule {
  type: "label-prefix";
  id?: string;
  /** In `extraRules`: run before the rule with this id (a rule's id defaults to its kind), so it wins the pair. */
  before?: string;
  kind: string;
  among: string;
  weight?: number;
  /** Also link labels equal once their (parenthesised) parts are dropped: "Student rePo (Android)" and "Student rePo (Web)". */
  stems?: boolean;
}

/** An entity's text names another entity. */
export interface NamedInRule {
  type: "named-in";
  id?: string;
  /** In `extraRules`: run before the rule with this id (a rule's id defaults to its kind), so it wins the pair. */
  before?: string;
  kind: string;
  /** Types whose names are looked for. */
  named: string[];
  /** Types whose text is read. Default: every type. */
  in?: string[];
  /** `text-to-named` links the text's owner to what it names; `named-to-text` the other way. Default `text-to-named`. */
  direction?: "text-to-named" | "named-to-text";
  weight?: number;
  weightFrom?: "named" | "text";
  /** Shortest name that counts, overall or per type. */
  minNameLength?: number | Record<string, number>;
}

export interface Topic {
  /** Becomes `topic:<key>`. */
  key: string;
  label: string;
  /** A regular expression (source string or RegExp), tested case-insensitively against entity text. */
  pattern: string | RegExp;
}

/** Subjects a text is about: telecom, fintech, music. Two things about the same subject are related. */
export interface TopicsRule {
  type: "topics";
  id?: string;
  /** In `extraRules`: run before the rule with this id (a rule's id defaults to its kind), so it wins the pair. */
  before?: string;
  kind: string;
  topics: Topic[];
  /** The type of the topic entities created. Default `topic`. */
  topicType?: string;
  in?: string[];
  weight?: number;
}

export type Rule = SharedRule | CoOccurRule | LabelPrefixRule | NamedInRule | TopicsRule;

export interface NextConfig {
  /** Each step back in the trail counts this much of the one after it. Default 0.6. */
  recency?: number;
  /** Share of light passed on a second step. Default 0.4. */
  secondStep?: number;
  /** Busy hubs pass on less: divided by sqrt(1 + degree / hubDamping). Default 3. */
  hubDamping?: number;
  /** Trail steps like `section:games` light every entity of a type a little. */
  sections?: Record<string, string>;
  /** How much a section lights its entities. Default 0.08. */
  sectionBoost?: number;
}

export interface MatchConfig {
  /** Words too common to count in a name. */
  stopWords?: string[];
  /** Names containing any of these never match (the owner's name is on their own pages). */
  ignore?: string[];
  /** A query asking for things like the one named. Regular expression source, tested on the normalised query. */
  similarPattern?: string;
  /** Words shorter than this must be spelled right ("hire" is not "Hive"). Default 4, as the portfolio site; 5 is stricter. */
  typoMinLength?: number;
  /** A word of 5+ letters found in only one name is enough on its own ("ragnarok"). Default false. */
  distinctWords?: boolean;
  /** A name of 3+ significant words matches with all but one of them ("red dead"). Default false. */
  partialWords?: boolean;
}

/** One case of a template, chosen when everything it names fits. */
export interface TemplateCase {
  item?: string;
  other?: string;
  direction?: "out" | "in";
  text: string;
}

export interface ReasonContext {
  reason: Reason;
  item: Entity;
  other?: Entity;
  /** Short label of the item and of the other end. */
  itemLabel: string;
  otherLabel: string;
  via: string;
}

/**
 * How a reason becomes a sentence. Strings use `{item}`, `{other}`, `{otherLower}`,
 * `{via}`, `{kind}` and `{name}`; a `[...]` part is dropped when a token in it is empty.
 */
export type Template =
  | string
  | { cases?: TemplateCase[]; out?: string; in?: string; default?: string }
  | ((ctx: ReasonContext) => string);

export interface PubbaConfig {
  types?: Record<string, TypeConfig>;
  kinds?: Record<string, KindConfig>;
  rules?: Rule[];
  /** Rules applied after `rules`. Unlike `rules`, these add up when configs are merged, so a site can extend a preset. */
  extraRules?: Rule[];
  next?: NextConfig;
  match?: MatchConfig;
  /** Keyed by reason kind: a link kind, `section`, `typed` or `match`. */
  templates?: Record<string, Template>;
}

/**
 * Why something is suggested, as data. `kind` is the link kind (or `section`,
 * `typed`, `match`); `to` is the entity on the other end of that link;
 * `direction` is `out` when the item is the link's `from`.
 */
export interface Reason {
  kind: string;
  to?: string;
  direction?: "out" | "in";
  via?: string[];
  /** The trail step this came from, when it took two steps to get here. */
  seed?: string;
  /** For `typed` and `match`: how the text matched. */
  by?: "name" | "alias" | "words" | "first-word" | "distinct-word" | "phrase" | "prefix" | "word-prefix" | "contains";
  /** For `match`: the name or alias that matched. */
  name?: string;
}

export interface Graph {
  entities: Map<string, Entity>;
  links: GraphLink[];
  /** Every link touching an entity. */
  adjacent: Map<string, GraphLink[]>;
  config: PubbaConfig;
}

/** A result with its reason and the reason as a sentence. */
export interface Explained {
  entity: Entity;
  reason: Reason;
  text: string;
}

export interface Related extends Explained {
  weight: number;
  link: GraphLink;
}

export interface Suggestion extends Explained {
  score: number;
}

export interface Match extends Explained {
  score: number;
  tier: number;
}

export interface MatchResult {
  query: string;
  /** `entity`: the query names one thing. `similar`: it asks for things like it. `none`: nothing here fits. */
  intent: "entity" | "similar" | "none";
  entity: Entity | null;
  match: Match | null;
  /** For `similar`: the things like it, with reasons. */
  similar: Related[];
}
