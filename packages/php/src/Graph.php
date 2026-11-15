<?php

declare(strict_types=1);

namespace Pubba;

use InvalidArgumentException;
use JsonException;

/** The graph inside a bundle: linked entities, unlinked ones (matchable, never suggested), links and config. */
final class Graph
{
    /** The bundle format this runtime reads. */
    public const BUNDLE_FORMAT = 1;

    /**
     * @param array<string, Entity> $entities
     * @param array<string, Entity> $unlinked
     * @param list<Link> $links
     * @param array<string, list<Link>> $adjacent
     * @param array<string, mixed> $config
     * @param array<string, true> $distinctWords
     */
    private function __construct(
        public readonly array $entities,
        public readonly array $unlinked,
        public readonly array $links,
        public readonly array $adjacent,
        public readonly array $config,
        public readonly array $distinctWords,
    ) {
    }

    /**
     * The graph inside a bundle (JSON text, or already decoded), after checking it is one this runtime can read.
     *
     * @param string|array<string, mixed> $bundle
     */
    public static function fromBundle(string|array $bundle): self
    {
        if (is_string($bundle)) {
            try {
                $bundle = json_decode($bundle, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                throw new InvalidArgumentException('pubba: not a pubba bundle');
            }
        }
        $format = $bundle['format'] ?? null;
        if (!is_array($bundle) || !(is_int($format) || is_float($format)) || !is_array($bundle['entities'] ?? null) || !is_array($bundle['links'] ?? null)) {
            throw new InvalidArgumentException('pubba: not a pubba bundle');
        }
        if (floor($format) > self::BUNDLE_FORMAT) {
            throw new InvalidArgumentException("pubba: bundle format $format is newer than this runtime reads (" . self::BUNDLE_FORMAT . '); upgrade pubba');
        }
        $links = [];
        $adjacent = [];
        foreach ($bundle['links'] as $l) {
            $link = new Link((string) $l['from'], (string) $l['kind'], (string) $l['to'], (float) $l['weight'], Text::strings($l['via'] ?? null), Text::str($l['rule'] ?? null));
            $links[] = $link;
            $adjacent[$link->from][] = $link;
            $adjacent[$link->to][] = $link;
        }
        $linked = [];
        $unlinked = [];
        $raws = array_merge($bundle['entities'], is_array($bundle['unlinked'] ?? null) && array_is_list($bundle['unlinked']) ? $bundle['unlinked'] : []);
        foreach ($raws as $raw) {
            if (!is_array($raw)) {
                continue;
            }
            $e = new Entity(
                (string) $raw['id'],
                (string) $raw['type'],
                (string) $raw['label'],
                Text::str($raw['short'] ?? null),
                Text::strings($raw['aliases'] ?? null) ?? [],
                Text::str($raw['url'] ?? null),
                Text::str($raw['text'] ?? null),
                is_array($raw['data'] ?? null) ? $raw['data'] : null,
            );
            if (isset($adjacent[$e->id])) {
                $linked[$e->id] = $e;
            } else {
                $unlinked[$e->id] = $e;
            }
        }
        $words = [];
        foreach (Text::strings(Text::obj($bundle['index'] ?? null)['distinctWords'] ?? null) ?? [] as $w) {
            $words[$w] = true;
        }
        return new self($linked, $unlinked, $links, $adjacent, Text::obj($bundle['config'] ?? null), $words);
    }

    /** @return list<Entity> */
    public function allEntities(): array
    {
        return [...array_values($this->entities), ...array_values($this->unlinked)];
    }

    public function find(string $id): ?Entity
    {
        return $this->entities[$id] ?? $this->unlinked[$id] ?? null;
    }

    public function degree(string $id): int
    {
        return count($this->adjacent[$id] ?? []);
    }

    /** @return array<string, mixed> */
    public function typeConfig(string $type): array
    {
        return Text::obj(Text::obj($this->config['types'] ?? null)[$type] ?? null);
    }

    public function isDestination(Entity $e): bool
    {
        return ($this->typeConfig($e->type)['destination'] ?? null) !== false;
    }

    public function pull(string $kind): float
    {
        return Text::num(Text::obj(Text::obj($this->config['kinds'] ?? null)[$kind] ?? null)['pull'] ?? null, 0.5);
    }

    public function kindLabel(string $kind): string
    {
        return Text::str(Text::obj(Text::obj($this->config['kinds'] ?? null)[$kind] ?? null)['label'] ?? null) ?? str_replace('-', ' ', $kind);
    }
}
