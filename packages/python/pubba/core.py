"""The pubba runtime: load a compiled bundle and answer from it (SPEC sections 1 to 6).

A port of the TypeScript reference; the conformance suite holds them to the
same answers, scores to 1e-9.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple, Union

from .events import GUIDE_VIAS, Events
from .text import contains_name, has_phrase, normalize

BUNDLE_FORMAT = 1
INF = float("inf")
DEFAULT_STOP_WORDS = ["the", "app", "and", "for", "web", "application", "mobile", "portal", "site", "website"]
DEFAULT_SIMILAR = r"\b(like|similar|alike|same stack|related to|anything else)\b"
DEFAULT_TEMPLATES: Dict[str, Any] = {
    "section": "{item} is worth a look.",
    "typed": "{item} matches what you typed.",
    "match": "{item} matches “{name}”.",
}
STRONG = 50

Reason = Dict[str, Any]


@dataclass(frozen=True)
class Entity:
    id: str
    type: str
    label: str
    short: Optional[str] = None
    aliases: Tuple[str, ...] = ()
    url: Optional[str] = None
    text: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    @property
    def short_label(self) -> str:
        """How it reads inside a sentence."""
        return self.short if self.short is not None else self.label


@dataclass(frozen=True)
class Link:
    from_: str
    kind: str
    to: str
    weight: float
    via: Optional[Tuple[str, ...]] = None
    rule: Optional[str] = None

    def other_end(self, id: str) -> str:
        return self.to if self.from_ == id else self.from_


@dataclass
class Suggestion:
    entity: Entity
    score: float
    reason: Reason
    text: str


@dataclass
class Related:
    entity: Entity
    weight: float
    link: Link
    reason: Reason
    text: str


@dataclass
class Match:
    entity: Entity
    score: float
    tier: int
    reason: Reason
    text: str


@dataclass
class MatchResult:
    query: str
    intent: str
    entity: Optional[Entity] = None
    match: Optional[Match] = None
    similar: List[Related] = field(default_factory=list)
    not_here: Optional[str] = None


@dataclass
class Graph:
    entities: Dict[str, Entity]
    unlinked: Dict[str, Entity]
    links: List[Link]
    adjacent: Dict[str, List[Link]]
    config: Dict[str, Any]
    distinct_words: Set[str]

    def all_entities(self) -> List[Entity]:
        return list(self.entities.values()) + list(self.unlinked.values())

    def find(self, id: str) -> Optional[Entity]:
        return self.entities.get(id) or self.unlinked.get(id)

    def degree(self, id: str) -> int:
        return len(self.adjacent.get(id, []))

    def type_config(self, type: str) -> Dict[str, Any]:
        return (self.config.get("types") or {}).get(type) or {}

    def is_destination(self, e: Entity) -> bool:
        return self.type_config(e.type).get("destination", True) is not False

    def pull(self, kind: str) -> float:
        return ((self.config.get("kinds") or {}).get(kind) or {}).get("pull", 0.5)

    def kind_label(self, kind: str) -> str:
        label = ((self.config.get("kinds") or {}).get(kind) or {}).get("label")
        return label if label is not None else kind.replace("-", " ")


def _entity(raw: Dict[str, Any]) -> Entity:
    return Entity(
        id=raw["id"],
        type=raw["type"],
        label=raw["label"],
        short=raw.get("short"),
        aliases=tuple(raw.get("aliases") or ()),
        url=raw.get("url"),
        text=raw.get("text"),
        data=raw.get("data"),
    )


def graph_from_bundle(bundle: Union[str, bytes, Dict[str, Any]]) -> Graph:
    """The graph inside a bundle, after checking it is one this runtime can read."""
    b = json.loads(bundle) if isinstance(bundle, (str, bytes)) else bundle
    if not isinstance(b, dict) or not isinstance(b.get("format"), (int, float)) or not isinstance(b.get("entities"), list) or not isinstance(b.get("links"), list):
        raise ValueError("pubba: not a pubba bundle")
    if math.floor(b["format"]) > BUNDLE_FORMAT:
        raise ValueError(f"pubba: bundle format {b['format']} is newer than this runtime reads ({BUNDLE_FORMAT}); upgrade pubba")
    links = [Link(l["from"], l["kind"], l["to"], l["weight"], tuple(l["via"]) if l.get("via") is not None else None, l.get("rule")) for l in b["links"]]
    adjacent: Dict[str, List[Link]] = {}
    for l in links:
        adjacent.setdefault(l.from_, []).append(l)
        adjacent.setdefault(l.to, []).append(l)
    linked: Dict[str, Entity] = {}
    unlinked: Dict[str, Entity] = {}
    for raw in list(b["entities"]) + list(b.get("unlinked") or []):
        e = _entity(raw)
        (linked if e.id in adjacent else unlinked)[e.id] = e
    index = b.get("index") or {}
    return Graph(linked, unlinked, links, adjacent, b.get("config") or {}, set(index.get("distinctWords") or []))


# Sentences (SPEC section 6).

_TOKEN = re.compile(r"\{(\w+)\}")
_OPTIONAL = re.compile(r"\[([^\]]*)\]")


def reason_from_link(link: Link, item_id: str, seed: Optional[str] = None) -> Reason:
    """The reason a link gives for the entity at one of its ends."""
    r: Reason = {"kind": link.kind, "to": link.other_end(item_id), "direction": "out" if link.from_ == item_id else "in"}
    if link.via:
        r["via"] = list(link.via)
    if seed and seed != r["to"]:
        r["seed"] = seed
    return r


def _fill(text: str, values: Dict[str, str]) -> str:
    def keep(m: "re.Match[str]") -> str:
        inner = m.group(1)
        return inner if all(values.get(t) for t in _TOKEN.findall(inner)) else ""

    return _TOKEN.sub(lambda m: values.get(m.group(1)) or "", _OPTIONAL.sub(keep, text))


def _pick(t: Any, reason: Reason, item: Entity, other: Optional[Entity]) -> Optional[str]:
    if isinstance(t, str):
        return t
    if callable(t):
        return t(reason, item, other)
    for c in t.get("cases") or []:
        if (not c.get("item") or c["item"] == item.type) and (not c.get("other") or (other is not None and c["other"] == other.type)) and (not c.get("direction") or c["direction"] == reason.get("direction")):
            return c["text"]
    if reason.get("direction") == "out" and t.get("out"):
        return t["out"]
    if reason.get("direction") == "in" and t.get("in"):
        return t["in"]
    for k in ("default", "out", "in"):
        if t.get(k) is not None:
            return t[k]
    return None


def render_reason(g: Graph, reason: Reason, item: Entity, templates: Optional[Dict[str, Any]] = None) -> str:
    """A reason as one sentence."""
    every = {**DEFAULT_TEMPLATES, **(g.config.get("templates") or {}), **(templates or {})}
    other = g.entities.get(reason["to"]) if reason.get("to") else None
    t = every.get(f"{reason['kind']}.{item.type}")
    if t is None:
        t = every.get(reason["kind"])
    text = _pick(t, reason, item, other) if t else None
    if text is None:
        if other is not None:
            text = "{other}: {kind} {item}[ ({via})]." if reason.get("direction") == "in" else "{item}: {kind} {other}[ ({via})]."
        else:
            text = "{item} is worth a look."
    if callable(t):
        return text
    other_label = other.short_label if other is not None else ""
    return _fill(
        text,
        {
            "item": item.short_label,
            "other": other_label,
            "otherLower": other_label.lower(),
            "via": ", ".join((reason.get("via") or [])[:3]),
            "kind": g.kind_label(reason["kind"]),
            "name": reason.get("name") or "",
        },
    )


# Matching (SPEC section 4).


def _significant(name: str, stop: Set[str]) -> List[str]:
    return [w for w in name.split(" ") if len(w) > 2 and w not in stop]


def _coverage(q: str, name: str, typo: float) -> float:
    name_tokens = name.split(" ")
    query_tokens = q.split(" ")
    in_query = sum(1 for w in name_tokens if has_phrase(q, w, typo)) / len(name_tokens)
    explained = sum(1 for t in query_tokens if any(t == w or has_phrase(t, w, typo) for w in name_tokens)) / len(query_tokens)
    return 0.5 * in_query + 0.4 * explained


def _score_name(q: str, name: str, is_alias: bool, m: Dict[str, Any], s: Dict[str, Any]) -> Optional[Tuple[float, str, str]]:
    if not name or len(name) < m.get("minLength", 0):
        return None
    typo = s["typo"]
    has = lambda w: has_phrase(q, w, typo)  # noqa: E731
    if m.get("mode", "title") == "phrase":
        if len(name) < 2 or not has(name):
            return None
        exact = not s["precise"] or contains_name(q, name)
        return ((100 if exact else 95) + len(name), "alias" if is_alias else "phrase", name)
    if contains_name(q, name):
        return (100 + len(name), "alias" if is_alias else "name", name)
    if s["precise"] and " " in name and has(name):
        return (95 + len(name), "alias" if is_alias else "name", name)
    words = _significant(name, s["stop"])
    hits = sum(1 for w in words if has(w))
    if hits and hits == len(words) and len("".join(words)) > m.get("minWordsLength", 0):
        return (50 + hits + (_coverage(q, name, typo) if s["precise"] else 0), "words", name)
    if s["partial"] and len(words) >= 3 and hits >= 2 and hits == len(words) - 1:
        return (40 + hits, "words", name)
    if s["distinct"] is not None:
        for w in words:
            if len(w) >= 5 and w in s["distinct"] and has_phrase(q, w, INF):
                return (25, "distinct-word", w)
    first = words[0] if words else None
    if m.get("firstWord") and first and len(first) > 3 and has(first):
        return (20, "first-word", first)
    return None


class Track:
    """The moments a site reports to its measurement, checked so no visitor text gets in."""

    def __init__(self, graph: Graph, events: Optional[Events]) -> None:
        self._graph = graph
        self._events = events

    def guide_opened(self) -> None:
        if self._events:
            self._events.emit({"type": "guide-opened"})

    def guided_to(self, id: str, via: str) -> bool:
        e = self._graph.find(id)
        if not self._events or e is None or via not in GUIDE_VIAS:
            return False
        self._events.emit({"type": "guided-to", "to": e.id, "entityType": e.type, "via": via})
        return True

    def reached(self, goal: str) -> bool:
        if not self._events or goal not in self._events.goals:
            return False
        self._events.emit({"type": "reached", "goal": goal})
        return True


class Pubba:
    """Answers from one graph: related items, what next, matching, sentences, measurement."""

    def __init__(self, graph: Graph, events: Optional[Events] = None) -> None:
        self.graph = graph
        self._events = events
        self.track = Track(graph, events)

    def get(self, id: str) -> Optional[Entity]:
        return self.graph.entities.get(id)

    def with_events(self, events: Optional[Events]) -> "Pubba":
        """The same graph, reporting to these events."""
        return Pubba(self.graph, events)

    def _suggested(self, source: str, out: Sequence[Union[Suggestion, Related]]) -> None:
        if self._events and out:
            kinds: List[str] = []
            for x in out:
                if x.reason["kind"] not in kinds:
                    kinds.append(x.reason["kind"])
            self._events.emit({"type": "suggested", "source": source, "ids": [x.entity.id for x in out], "reasonKinds": kinds})

    # --- matching

    def search(self, query: str, limit: int = 10, types: Optional[Sequence[str]] = None, templates: Optional[Dict[str, Any]] = None) -> List[Match]:
        """Every entity a query could mean, best first."""
        g = self.graph
        q = normalize(query)
        if not q:
            return []
        mc = g.config.get("match") or {}
        stop = set(mc.get("stopWords", DEFAULT_STOP_WORDS))
        settings = {
            "stop": stop,
            "typo": mc.get("typoMinLength", 4),
            "partial": bool(mc.get("partialWords", False)),
            "precise": bool(mc.get("precise", False)),
            "distinct": g.distinct_words if mc.get("distinctWords") else None,
        }
        ignore = [w for w in (normalize(x) for x in mc.get("ignore", [])) if w]
        out: List[Match] = []
        for entity in g.all_entities():
            if types is not None and entity.type not in types:
                continue
            m = g.type_config(entity.type).get("match") or {}
            if m.get("skip"):
                continue
            best: Optional[Tuple[float, str, str]] = None
            for raw, is_alias in [(entity.label, False)] + [(a, True) for a in entity.aliases]:
                name = normalize(raw)
                if any(w in name for w in ignore):
                    continue
                s = _score_name(q, name, is_alias, m, settings)
                if s and (best is None or s[0] > best[0]):
                    best = s
            if best is None:
                continue
            reason: Reason = {"kind": "match", "by": best[1], "name": best[2]}
            out.append(Match(entity, best[0], m.get("tier", 1), reason, render_reason(g, reason, entity, templates)))
        precise = settings["precise"]
        out.sort(key=lambda x: ((1 if precise and x.score < STRONG else 0), x.tier, -x.score))
        return out[:limit]

    def match(self, query: str, similar_limit: int = 3, templates: Optional[Dict[str, Any]] = None) -> MatchResult:
        """What a query means: one entity, things like one, or nothing here."""
        result = self._match(query, similar_limit, templates)
        if self._events:
            event: Dict[str, Any] = {"type": "matched", "intent": result.intent}
            if result.entity is not None:
                event["entityType"] = result.entity.type
            if result.match is not None and result.match.reason.get("by"):
                event["by"] = result.match.reason["by"]
            self._events.emit(event)
        return result

    def _match(self, query: str, similar_limit: int, templates: Optional[Dict[str, Any]]) -> MatchResult:
        g = self.graph
        found = self.search(query, 1, templates=templates)
        best = found[0] if found else None
        q = normalize(query)
        mc = g.config.get("match") or {}
        typo = mc.get("typoMinLength", 4)
        missing = None
        for raw in mc.get("notHere", []):
            name = normalize(raw)
            if name and has_phrase(q, name, typo) and (missing is None or len(name) > len(missing[1])):
                missing = (raw, name)
        if missing and (best is None or len(missing[1]) > len(best.reason.get("name") or normalize(best.entity.label))):
            return MatchResult(query, "none", not_here=missing[0])
        if best is None:
            return MatchResult(query, "none")
        kinds = g.type_config(best.entity.type).get("similar")
        if kinds is not False and re.search(mc.get("similarPattern", DEFAULT_SIMILAR), q):
            similar = [
                Related(e, l.weight, l, reason_from_link(l, e.id), render_reason(g, reason_from_link(l, e.id), e, templates))
                for e, l in self._neighbours(best.entity.id, kinds)
                if g.is_destination(e)
            ][:similar_limit]
            if similar:
                return MatchResult(query, "similar", best.entity, best, similar)
        return MatchResult(query, "entity", best.entity, best)

    # --- related and next

    def _neighbours(self, id: str, kinds: Optional[Sequence[str]] = None) -> List[Tuple[Entity, Link]]:
        out = []
        for l in self.graph.adjacent.get(id, []):
            if kinds is not None and l.kind not in kinds:
                continue
            e = self.graph.entities.get(l.other_end(id))
            if e is not None:
                out.append((e, l))
        return sorted(out, key=lambda x: -x[1].weight)

    def related(self, id: str, kinds: Optional[Sequence[str]] = None, limit: Optional[int] = None, destinations_only: bool = True, accept: Optional[Callable[[Entity], bool]] = None, templates: Optional[Dict[str, Any]] = None) -> List[Related]:
        """What is related to one entity, strongest link first, each with why."""
        g = self.graph
        pairs = sorted(self._neighbours(id, kinds), key=lambda x: (-x[1].weight, -g.pull(x[1].kind)))
        pairs = [(e, l) for e, l in pairs if (not destinations_only or g.is_destination(e)) and (accept is None or accept(e))]
        if limit is not None:
            pairs = pairs[:limit]
        out = []
        for e, l in pairs:
            reason = reason_from_link(l, e.id)
            out.append(Related(e, l.weight, l, reason, render_reason(g, reason, e, templates)))
        self._suggested("related", out)
        return out

    def spread(self, trail: Sequence[str]) -> Tuple[Dict[str, float], Dict[str, Tuple[Link, str, str, float]], Dict[str, float], Set[str]]:
        """How brightly each entity lights up for this trail, with the strongest reason for each."""
        g = self.graph
        cfg = g.config.get("next") or {}
        recency = cfg.get("recency", 0.6)
        second = cfg.get("secondStep", 0.4)
        hub = cfg.get("hubDamping", 3)
        boost = cfg.get("sectionBoost", 0.08)
        sections = cfg.get("sections") or {}
        score: Dict[str, float] = {}
        why: Dict[str, Tuple[Link, str, str, float]] = {}
        section_only: Set[str] = set()

        def give(id: str, part: float, link: Link, src: str, seed: str) -> None:
            score[id] = score.get(id, 0) + part
            if part > (why[id][3] if id in why else 0):
                why[id] = (link, src, seed, part)

        seeds: Dict[str, float] = {}
        for id in reversed(list(trail)):
            if id not in seeds:
                seeds[id] = recency ** len(seeds)
        for seed, w in seeds.items():
            if seed.startswith("section:"):
                type = sections.get(seed[8:])
                if not type:
                    continue
                for e in g.entities.values():
                    if e.type != type:
                        continue
                    score[e.id] = score.get(e.id, 0) + w * boost * min(1, g.degree(e.id) / 8)
                    section_only.add(e.id)
                continue
            for l1 in g.adjacent.get(seed, []):
                mid = l1.other_end(seed)
                a = w * l1.weight * g.pull(l1.kind)
                give(mid, a, l1, seed, seed)
                carry = (a * second) / math.sqrt(1 + g.degree(mid) / hub)
                for l2 in g.adjacent.get(mid, []):
                    far = l2.other_end(mid)
                    if far == seed:
                        continue
                    give(far, carry * l2.weight * g.pull(l2.kind), l2, mid, seed)
        return score, why, seeds, section_only

    def next(self, trail: Sequence[str], limit: int = 3, exclude: Sequence[str] = (), accept: Optional[Callable[[Entity], bool]] = None, templates: Optional[Dict[str, Any]] = None) -> List[Suggestion]:
        """The next things to suggest after this trail: unseen, worth going to, and mixed."""
        g = self.graph
        score, why, seeds, section_only = self.spread(trail)
        skip = set(seeds) | set(exclude)
        ranked = []
        for id, s in score.items():
            e = g.entities.get(id)
            if e is None or not (id in why or id in section_only) or not g.is_destination(e) or id in skip or (accept is not None and not accept(e)):
                continue
            ranked.append((e, s, why.get(id)))
        ranked.sort(key=lambda r: -r[1])
        cap = max(1, limit - 1)
        taken: List[int] = []
        per_type: Dict[str, int] = {}
        for i, r in enumerate(ranked):
            if len(taken) == limit:
                break
            if per_type.get(r[0].type, 0) >= cap:
                continue
            per_type[r[0].type] = per_type.get(r[0].type, 0) + 1
            taken.append(i)
        for i in range(len(ranked)):
            if len(taken) < limit and i not in taken:
                taken.append(i)
        chosen = sorted((ranked[i] for i in taken), key=lambda r: -r[1])
        out = []
        for e, s, w in chosen:
            reason = reason_from_link(w[0], e.id, w[2]) if w else {"kind": "section"}
            out.append(Suggestion(e, s, reason, render_reason(g, reason, e, templates)))
        self._suggested("next", out)
        return out

    def autocomplete(self, typed: str, trail: Sequence[str] = (), limit: int = 3, accept: Optional[Callable[[Entity], bool]] = None, templates: Optional[Dict[str, Any]] = None) -> List[Suggestion]:
        """Type-ahead: names that start with (or contain) what's typed, nearest the trail first."""
        g = self.graph
        q = normalize(typed)
        if len(q) < 2:
            return []
        near = self.spread(trail)[0]
        hits = []
        for e in g.entities.values():
            if not g.is_destination(e) or (accept is not None and not accept(e)):
                continue
            name = normalize(e.label)
            kind = 3 if name.startswith(q) else 2 if any(w.startswith(q) for w in name.split(" ")) else 1 if len(q) >= 3 and q in name else 0
            if not kind:
                continue
            by = "prefix" if kind == 3 else "word-prefix" if kind == 2 else "contains"
            hits.append((e, by, kind * 10 + near.get(e.id, 0) * 5 + min(g.degree(e.id), 20) / 20))
        hits.sort(key=lambda h: -h[2])
        out = []
        for e, by, rank in hits[:limit]:
            reason: Reason = {"kind": "typed", "by": by}
            out.append(Suggestion(e, rank, reason, render_reason(g, reason, e, templates)))
        return out

    def explain(self, reason: Reason, item: Union[Entity, str], templates: Optional[Dict[str, Any]] = None) -> str:
        """A reason as a sentence."""
        e = self.graph.entities.get(item) if isinstance(item, str) else item
        if e is None:
            raise KeyError(f"pubba: no entity {item}")
        return render_reason(self.graph, reason, e, templates)


def load_bundle(bundle: Union[str, bytes, Dict[str, Any]], events: Optional[Events] = None) -> Pubba:
    """Answers from a compiled bundle (`pubba compile`), exactly as the content it was compiled from."""
    return Pubba(graph_from_bundle(bundle), events)
