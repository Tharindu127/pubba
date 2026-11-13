"""pubba: a small brain for showroom sites, in Python.

Load a bundle compiled by `pubba compile` and answer: related items with
reasons, what next from a visitor's trail, typo-tolerant matching, a headless
guide, and privacy-safe measurement events. Same answers as every other pubba
runtime: the conformance suite holds them to it.
"""

from .core import BUNDLE_FORMAT, Entity, Graph, Link, Match, MatchResult, Pubba, Related, Suggestion, graph_from_bundle, load_bundle, reason_from_link, render_reason
from .events import GUIDE_VIAS, Events, create_events, summarise
from .guide import DEFAULT_GUIDE_TEMPLATES, EntityChip, Guide, NudgePolicy, QuestionChip, Reply, create_guide
from .text import close_to, contains_name, edit_distance, has_phrase, normalize
from .trail import Trail, create_trail, section_step

__version__ = "0.4.0"

__all__ = [
    "BUNDLE_FORMAT", "Entity", "Graph", "Link", "Match", "MatchResult", "Pubba", "Related", "Suggestion",
    "graph_from_bundle", "load_bundle", "reason_from_link", "render_reason",
    "GUIDE_VIAS", "Events", "create_events", "summarise",
    "DEFAULT_GUIDE_TEMPLATES", "EntityChip", "Guide", "NudgePolicy", "QuestionChip", "Reply", "create_guide",
    "close_to", "contains_name", "edit_distance", "has_phrase", "normalize",
    "Trail", "create_trail", "section_step", "__version__",
]
