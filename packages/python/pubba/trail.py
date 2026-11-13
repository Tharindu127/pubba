"""The visitor's trail (SPEC section 7)."""

from __future__ import annotations

import json
from typing import Callable, List, Optional, Protocol


class TrailStorage(Protocol):
    def get_item(self, key: str) -> Optional[str]: ...
    def set_item(self, key: str, value: str) -> None: ...


class Trail:
    """A visitor's trail through the site, in entity ids, most recent last. Never sent anywhere."""

    def __init__(self, max: int = 24, storage: Optional[TrailStorage] = None, key: str = "pubba-trail") -> None:
        self._max = max
        self._storage = storage
        self._key = key
        self._steps: List[str] = []
        self._loaded = False
        self._listeners: List[Callable[[], None]] = []

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            saved = json.loads((self._storage.get_item(self._key) if self._storage else None) or "[]")
            if isinstance(saved, list):
                self._steps = [x for x in saved if isinstance(x, str)][-self._max :]
        except Exception:
            # A broken or missing save starts a fresh trail.
            pass

    def _save(self) -> None:
        try:
            if self._storage:
                self._storage.set_item(self._key, json.dumps(self._steps))
        except Exception:
            # Storage full or blocked: the trail lives on in memory.
            pass
        for listener in list(self._listeners):
            listener()

    def record(self, id: Optional[str]) -> None:
        """One step; the same step twice in a row counts once."""
        if not id:
            return
        self._load()
        if self._steps and self._steps[-1] == id:
            return
        self._steps = (self._steps + [id])[-self._max :]
        self._save()

    def get(self) -> List[str]:
        self._load()
        return list(self._steps)

    def clear(self) -> None:
        self._loaded = True
        self._steps = []
        self._save()

    def subscribe(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Called after every change; returns an unsubscribe function."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None


def create_trail(max: int = 24, storage: Optional[TrailStorage] = None, key: str = "pubba-trail") -> Trail:
    return Trail(max=max, storage=storage, key=key)


def section_step(section: str) -> str:
    """A trail step for opening a section, which lights every entity of its type a little."""
    return "section:" + section
