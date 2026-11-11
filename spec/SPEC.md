# pubba runtime specification

Version 1, for bundle format 1. This is what every pubba runtime implements,
in any language. The TypeScript package is the reference; where this text and
the conformance suite (`conformance/`) disagree, the suite wins and this text
is fixed.

A runtime loads a **bundle** (written by `pubba compile`) and answers:
`match`, `search`, `next`, `related`, `autocomplete`, `explain`, plus the
**trail**, **events** and the **guide**. Everything that builds the graph
(content, rules, topics, weights) happened at compile time and is not part of a
runtime.

Conventions: "in order" means the order of the bundle's arrays. All sorts are
**stable**: equal keys keep their current order. Numbers are 64-bit floats,
computed in the order written here.

---

## 1. Loading a bundle

1. Reject anything that isn't an object with a numeric `format` and arrays
   `entities` and `links`. Reject `format` above the runtime's own (1).
2. `all = entities ++ unlinked` (in order).
3. For each link in order: append it to `adjacent[from]`, then to `adjacent[to]`.
4. Each entity of `all`, in order, is **linked** if `adjacent` has its id, else
   **unlinked**. Keep both as ordered maps by id.
5. `config` is used as given. Missing settings take the defaults below.
6. `index.distinctWords` is the set of distinct words (section 4.4).

An id may appear in a trail or a call without existing; it is then ignored as
each section says.

## 2. Config defaults

| Setting | Default |
| --- | --- |
| `types[t].destination` | true |
| `types[t].match` | `{ tier: 1, mode: "title", firstWord: false, minLength: 0, minWordsLength: 0, skip: false }` |
| `types[t].similar` | none (every kind) |
| `kinds[k].pull` | 0.5 |
| `kinds[k].label` | `k` with every `-` replaced by a space |
| `next.recency` / `secondStep` / `hubDamping` / `sectionBoost` | 0.6 / 0.4 / 3 / 0.08 |
| `next.sections` | none |
| `match.stopWords` | the, app, and, for, web, application, mobile, portal, site, website |
| `match.typoMinLength` | 4 |
| `match.distinctWords`, `partialWords`, `precise` | false |
| `match.ignore`, `notDistinct`, `notHere` | empty |
| `match.similarPattern` | `\b(like\|similar\|alike\|same stack\|related to\|anything else)\b` |

**Destination**: an entity whose type's `destination` isn't false. Only
destinations are suggested.

## 3. Text

### 3.1 normalize(s)

1. Lowercase (Unicode default case mapping, no locale).
2. Unicode NFKD.
3. Remove code points U+0300 to U+036F.
4. Replace every character that is not `a-z`, `0-9`, `+`, `#`, `.` or white space with a space.
5. Replace every run of white space with one space; trim both ends.

Examples: "Café" is "cafe", "C#" is "c#", "ﬁle" is "file", "ß" is "" (removed).

### 3.2 editDistance(a, b)

Optimal string alignment on characters: insertions, deletions and
substitutions cost 1; swapping two neighbouring characters costs 1 (no
character is edited twice).

### 3.3 closeTo(token, word, typoMinLength)

In order:
1. No token: false.
2. `token == word` or `token == word + "s"`: true.
3. `word` shorter than 4, or containing any character outside `a-z`: false.
4. `token` starts with `word`: true.
5. `token` shorter than 3, or `word` shorter than `typoMinLength`: false.
6. `max` = 2 if `word` has 7 or more characters, else 1.
7. True if `editDistance(token, word) <= max`, or if `token` is longer than
   `word` and `editDistance(token[0 .. len(word)], word) <= max`.

`typoMinLength` of infinity means rules 5 to 7 never pass ("spelled right").

### 3.4 hasPhrase(query, phrase, typoMinLength)

`tokens = query split on " "`, `words = phrase split on " "`. True if some
window of `len(words)` consecutive tokens has `closeTo(tokens[i+j], words[j])`
for every j.

### 3.5 containsName(query, name)

True if `" " + query + " "` contains `" " + name + " "`.

## 4. Matching

### 4.1 Settings for one query

`q = normalize(query)`. If `q` is empty, `search` returns nothing. `stop` =
`match.stopWords`; `typo` = `match.typoMinLength`.

**Significant words** of a name: its words (split on " ") longer than 2
characters and not in `stop`.

### 4.2 Scoring one name

`name = normalize(label or alias)`; `m` = the entity type's match settings.
First rule that applies:

1. `name` empty, or shorter than `m.minLength`: no score.
2. **Phrase mode** (`m.mode == "phrase"`): if `name` is shorter than 2 or
   `hasPhrase(q, name, typo)` is false, no score. Otherwise the score is
   100 + len(name) (95 + len(name) when `precise` and not `containsName(q, name)`).
   `by` is "alias" for an alias, else "phrase".
3. `containsName(q, name)`: 100 + len(name); `by` "alias" or "name".
4. `precise`, `name` contains a space, and `hasPhrase(q, name, typo)`:
   95 + len(name); `by` "alias" or "name".
5. `words` = significant words of `name`; `hits` = how many satisfy
   `hasPhrase(q, w, typo)`. If `hits > 0`, `hits == len(words)` and the words'
   characters together number more than `m.minWordsLength`:
   50 + hits, plus `coverage(q, name)` when `precise`; `by` "words".
6. `partialWords`, `len(words) >= 3`, `hits >= 2`, `hits == len(words) - 1`:
   40 + hits; `by` "words".
7. `distinctWords`, and the first word `w` of `words` (in order) with at least 5
   characters, `w` in the distinct set, and `hasPhrase(q, w, infinity)`: 25;
   `by` "distinct-word"; `name` is `w`.
8. `m.firstWord`, and the first significant word has more than 3 characters and
   `hasPhrase(q, first, typo)`: 20; `by` "first-word"; `name` is that word.

`coverage(q, name)` = 0.5 x (share of `name`'s words w with `hasPhrase(q, w, typo)`)
+ 0.4 x (share of `q`'s tokens t where some name word w has `t == w` or
`hasPhrase(t, w, typo)`).

### 4.3 search(query, limit, types)

For each entity of `all` in order (linked, then unlinked as loaded), skipping
types not in `types` (when given) and types with `match.skip`:
- Score its label, then each alias in order, skipping any whose normalised form
  contains a normalised `match.ignore` word. Keep the highest score (the first
  one on ties).
- With a score, it's a candidate: `{ entity, score, tier: m.tier, reason: { kind: "match", by, name }, text }`.

Sort candidates by: (when `precise`) score below 50 after score 50 and above;
then tier ascending; then score descending. Return the first `limit` (default 10).

### 4.4 Distinct words

From the bundle's `index.distinctWords`. (Defined as: significant words of the
normalised labels and aliases of all non-skipped entities that belong to
exactly one entity, minus normalised `notDistinct`.)

### 4.5 match(query)

1. `best` = first result of `search(query, 1)`.
2. **Not here:** among `match.notHere` names (normalised, non-empty) with
   `hasPhrase(q, n, typo)`, take the longest (the first on ties). If there is
   one, and either no `best` or it is longer than `best`'s matched name
   (`reason.name`, else its normalised label): answer
   `{ intent: "none", notHere: <original name> }`.
3. No `best`: `{ intent: "none" }`.
4. If `q` matches `similarPattern` (a regular expression; runtimes may treat it
   as the word list it contains): `similar` = the best entity's neighbours
   (section 5.1) by its type's `similar` kinds, destinations only, first 3,
   each with its link reason and sentence. If not empty:
   `{ intent: "similar", entity, match: best, similar }`.
5. Otherwise `{ intent: "entity", entity, match: best }`.

## 5. Related and next

### 5.1 neighbours(id, kinds)

For each link of `adjacent[id]` in order (of the given kinds, when given), the
entity at the other end if it is linked; sorted by link weight descending.

### 5.2 related(id, kinds, limit)

`neighbours(id, kinds)`, then sorted by weight descending and, on equal
weights, the link kind's pull descending; destinations only; first `limit`.
Each: `{ entity, weight, link, reason (5.5), text (6) }`. Unknown id: nothing.

### 5.3 spread(trail)

- **Seeds:** walk the trail from the last step back; each id not already seen
  becomes a seed with weight `recency ^ (number of seeds before it)`.
- For each seed in that order:
  - `section:<s>` with `next.sections[s] = type`: for each linked entity of that
    type, in order, add `w x sectionBoost x min(1, degree / 8)` to its score and
    mark it section-lit. (Unknown sections do nothing.)
  - Otherwise, for each link `l1` of `adjacent[seed]` in order: `mid` is its
    other end; `a = w x l1.weight x pull(l1.kind)`; give `a` to `mid` via `l1`
    from `seed`. Then `carry = a x secondStep / sqrt(1 + degree(mid) / hubDamping)`;
    for each link `l2` of `adjacent[mid]` in order whose other end `far` isn't
    the seed: give `carry x l2.weight x pull(l2.kind)` to `far` via `l2` from `mid`.
- **give(id, part, link, from, seed):** add `part` to `score[id]`; if `part` is
  greater than the best part so far for `id`, `why[id] = { link, from, seed, part }`.
- `degree(id)` = number of links in `adjacent[id]`. Scores keep the order in
  which ids first received any.

### 5.4 next(trail, limit = 3, exclude)

1. `spread(trail)`.
2. Candidates, in score order of first receipt: linked entities with a `why` or
   section-lit, that are destinations, not a seed, not in `exclude`.
3. Sort by score descending.
4. **Mix:** `cap = max(1, limit - 1)`. Take candidates in order, skipping any
   whose type already has `cap` taken, until `limit`. Then fill up to `limit`
   from the rest, in order.
5. Sort the taken ones by score descending.
6. Reason: from `why` (5.5, with its link, the candidate's id and the seed), or
   `{ kind: "section" }` when only a section lit it.

### 5.5 Reason from a link

For entity `id` and link `l`: `{ kind: l.kind, to: <other end>, direction: "out"
if l.from == id else "in", via: l.via (only if not empty), seed (only if given
and not equal to to) }`.

### 5.6 autocomplete(typed, trail, limit = 3)

`q = normalize(typed)`; under 2 characters: nothing. `near` = `spread(trail)`
scores. For each linked destination in order: `name = normalize(label)`;
`kind` = 3 if `name` starts with `q`, else 2 if some word of `name` starts with
`q`, else 1 if `q` has 3 or more characters and `name` contains it, else skip.
`rank = kind x 10 + near(id) x 5 + min(degree, 20) / 20`. Sort by rank
descending; first `limit`. Reason `{ kind: "typed", by: "prefix" | "word-prefix" | "contains" }`;
the result's `score` is the rank.

## 6. Sentences

`explain(reason, item)`:

1. Templates = built-in (`section`: "{item} is worth a look.", `typed`:
   "{item} matches what you typed.", `match`: "{item} matches “{name}”."),
   overlaid by the bundle's `config.templates`.
2. `t` = template `"<kind>.<item type>"`, else `"<kind>"`.
3. Text from `t`:
   - a string: itself;
   - an object: the first of `cases` whose `item`, `other` and `direction`
     (each only when given) all fit; else `out` for direction out, `in` for
     direction in; else `default`, else `out`, else `in`.
4. No text: `"{other}: {kind} {item}[ ({via})]."` for direction in,
   `"{item}: {kind} {other}[ ({via})]."` otherwise, or `"{item} is worth a look."`
   when the reason has no `to`.
5. Fill: first, every `[...]` part whose tokens aren't all non-empty is removed
   (brackets included); the others lose their brackets. Then each `{token}` is
   replaced:
   - `item`: the item's `short`, else its `label`
   - `other`: the same for the entity named by `to` (empty if none)
   - `otherLower`: `other` lowercased
   - `via`: the first three `via` entries joined with ", "
   - `kind`: the kind's label
   - `name`: the reason's `name`
   - unknown tokens: empty

## 7. Trail

An ordered list of ids, most recent last, at most `max` (default 24) kept.
`record(id)` ignores an empty id and an id equal to the last one; otherwise
appends and drops the oldest beyond `max`. Persisting it is the runtime's
choice (session storage, preferences); a broken saved value starts empty.

## 8. Events

Emitted only when an events sink is attached; never stored or sent by pubba.

| Event | When | Fields |
| --- | --- | --- |
| `suggested` | `next` or `related` returns at least one item | `source` ("next" or "related"), `ids`, `reasonKinds` (distinct, in order) |
| `matched` | every `match` | `intent`; `entityType` and `by` when matched |
| `guide-opened` | `track.guideOpened()` | |
| `guided-to` | `track.guidedTo(id, via)` with a known id (linked or unlinked) and `via` one of suggestion, chip, typed, match, related | `to`, `entityType`, `via` |
| `reached` | `track.reached(goal)` with a declared goal (default contact, resume) | `goal` |

Fields hold only ids, types, kinds and declared goals; never a query. A
listener that fails is ignored.

## 9. Guide

State: the trail, `lastStepAt`, `lastStepSelf`, `lastNudgeAt` (both times start
at minus infinity), and the set `nudgedFrom`. A clock gives the time in ms.
`route(entity)` gives its url (default: the entity's `url`). `chipCount`
defaults to 3. Templates (each overridable):

| Key | Default |
| --- | --- |
| open | "Here's {item}." |
| similar | "{reason}" |
| none | "I couldn't find that here. These might help:" |
| notHere | "{name} isn't here. These might help:" |
| start | "Where would you like to start?" |
| nudge | "{reason} Want a look?" |

A template for an entity is looked up as `"<key>.<entity type>"` first, then
`"<key>"` (for `open`, `similar` with the asked-about entity's type, and
`nudge`). Templates are filled by replacing `{item}` (short label), `{label}`
(full label), `{line}` (the site's `line(entity)`, else empty), `{reason}` (a
sentence) and `{name}`; for `similar` also `{of}` (the asked-about entity's
full label) and `{list}` (each similar item's full label, followed by
` (<first two via, joined by ", ">)` when it has any, joined by ", "); unknown
tokens are empty; then runs of white space become one space and the text is
trimmed.

Options a site may pass (all optional; without them the guide behaves as
written below with no filter, no fallback and no lines):

- `accept(entity)`: only accepted entities may be suggested. It filters `next`
  (chips and nudges), the starters, and the similar items.
- `fallback(context)`: chips when `next` gives none, before the starters;
  `context` is `{ kind, entity? }` with kind `start`, `none`, `not-here`,
  `open` (with the entity) or `chips`. Strings become question chips
  `{ label, question }` (both the string). At most `n` are used.
- `line(entity)`: the text for `{line}`.
- `nudge.prefer(entity)`: which option a nudge takes first (default: one with
  a route).

- **chip(s):** `{ id, label: short or label, url: route(entity) (if any), reason, text }`; the public `chips(n)` uses context `{ kind: "chips" }`.
- **chips(n = chipCount, extra = [], context):** `next(trail ++ extra, n)` (with
  `accept`) as chips; if empty, the first `n` of `fallback(context)` when it
  gives a list; else the **starters**: accepted linked destinations sorted by
  degree descending (ties in order), first `n`, each with reason
  `{ kind: "section" }` and its sentence.
- **ask(question):**
  - blank (only white space): `{ kind: "start", text: start, chips: chips(chipCount, [], { kind: "start" }) }`.
  - `m = match(question)`:
    - `none` with `notHere`: `{ kind: "not-here", text: notHere(name), chips: chips(chipCount, [], { kind: "not-here" }) }`;
    - `none`: `{ kind: "none", text: none, chips: chips(chipCount, [], { kind: "none" }) }`;
    - `similar` (after `accept` leaves at least one): the first similar item
      becomes the action; `{ kind: "similar", text: similar(item, label and line
      of the first, reason = its sentence, of, list), action: open(it), chips:
      the rest, first chipCount, as chips, similar: all of them as chips }`;
    - `entity`: `{ kind: "open", text: open(item, label, line of it), action: open(it), chips }`,
      where chips are `chips(chipCount, [its id], { kind: "open", entity })`
      without itself if it is linked, else `chips(chipCount, [], the same context)`.
  - `open(e)` = `{ type: "open", id, url: route(e) (if any) }`.
  - Asking doesn't change the trail.
- **visited(id):** known ids and `section:` steps only: record it; `lastStepAt = now`; `lastStepSelf = true`.
- **follow(id, via):** known ids only: record it; `lastStepAt = now`;
  `lastStepSelf = false`; `track.guidedTo(id, via)`.
- **nudge():** null unless all hold: there is a last step; `lastStepSelf`; it
  isn't a `section:` step; it isn't in `nudgedFrom`; `now - lastStepAt >= delayMs`
  (default 9000); `now - lastNudgeAt >= gapMs` (default 60000). Then
  `options` = `next(trail, 5)` (with `accept`) without section reasons and with
  score at least `minScore` (default 0.3); `top` = the first option `prefer`
  accepts, else the first; none: null. Otherwise `lastNudgeAt = now`, add the last step to
  `nudgedFrom`, and answer `{ kind: "open", text: nudge(item, label and line of top, reason = top's sentence), action: open(top), chips: [top as a chip] }`.
- **opened()**, **reached(goal):** `track.guideOpened()`, `track.reached(goal)`.
