<?php

declare(strict_types=1);

namespace Pubba;

/** Why something was suggested or matched, as data. Pubba::explain turns it into a sentence. */
final class Reason
{
    /** @param list<string>|null $via */
    public function __construct(
        public readonly string $kind,
        public readonly ?string $to = null,
        public readonly ?string $direction = null,
        public readonly ?array $via = null,
        public readonly ?string $seed = null,
        public readonly ?string $by = null,
        public readonly ?string $name = null,
    ) {
    }

    /** @return array<string, mixed> The reason as JSON data, absent fields left out. */
    public function toArray(): array
    {
        return array_filter([
            'kind' => $this->kind,
            'to' => $this->to,
            'direction' => $this->direction,
            'via' => $this->via,
            'seed' => $this->seed,
            'by' => $this->by,
            'name' => $this->name,
        ], static fn ($v) => $v !== null);
    }

    /** @param array<string, mixed> $m */
    public static function fromArray(array $m): self
    {
        return new self(
            (string) $m['kind'],
            Text::str($m['to'] ?? null),
            Text::str($m['direction'] ?? null),
            Text::strings($m['via'] ?? null),
            Text::str($m['seed'] ?? null),
            Text::str($m['by'] ?? null),
            Text::str($m['name'] ?? null),
        );
    }
}
