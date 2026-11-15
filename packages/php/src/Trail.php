<?php

declare(strict_types=1);

namespace Pubba;

use Closure;
use Throwable;

/** A visitor's trail through the site, in entity ids, most recent last. Never sent anywhere. */
final class Trail
{
    /** @var list<string> */
    private array $steps = [];
    private bool $loaded = false;
    /** @var list<Closure> */
    private array $listeners = [];

    public function __construct(
        public readonly int $max = 24,
        public readonly ?TrailStorage $storage = null,
        public readonly string $key = 'pubba-trail',
    ) {
    }

    /** A trail step for opening a section, which lights every entity of its type a little. */
    public static function sectionStep(string $section): string
    {
        return "section:$section";
    }

    private function load(): void
    {
        if ($this->loaded) {
            return;
        }
        $this->loaded = true;
        try {
            $saved = json_decode($this->storage?->getItem($this->key) ?? '[]', true);
            if (is_array($saved) && array_is_list($saved)) {
                $all = array_values(array_filter($saved, 'is_string'));
                $this->steps = count($all) > $this->max ? array_slice($all, -$this->max) : $all;
            }
        } catch (Throwable) {
            // A broken or missing save starts a fresh trail.
        }
    }

    private function save(): void
    {
        try {
            $this->storage?->setItem($this->key, json_encode($this->steps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        } catch (Throwable) {
            // Storage full or blocked: the trail lives on in memory.
        }
        foreach ($this->listeners as $l) {
            $l();
        }
    }

    /** One step; the same step twice in a row counts once. */
    public function record(?string $id): void
    {
        if ($id === null || $id === '') {
            return;
        }
        $this->load();
        if ($this->steps !== [] && $this->steps[count($this->steps) - 1] === $id) {
            return;
        }
        $next = [...$this->steps, $id];
        $this->steps = count($next) > $this->max ? array_slice($next, -$this->max) : $next;
        $this->save();
    }

    /** @return list<string> */
    public function get(): array
    {
        $this->load();
        return $this->steps;
    }

    public function clear(): void
    {
        $this->loaded = true;
        $this->steps = [];
        $this->save();
    }

    /** Called after every change; returns an unsubscribe function. */
    public function subscribe(callable $listener): Closure
    {
        $l = Closure::fromCallable($listener);
        $this->listeners[] = $l;
        return function () use ($l): void {
            $i = array_search($l, $this->listeners, true);
            if ($i !== false) {
                array_splice($this->listeners, $i, 1);
            }
        };
    }
}
