<?php

declare(strict_types=1);

namespace Pubba;

/** One thing on the site or in the app: a project, a skill, a product, a page. */
final class Entity
{
    /**
     * @param list<string> $aliases
     * @param array<string, mixed>|null $data
     */
    public function __construct(
        public readonly string $id,
        public readonly string $type,
        public readonly string $label,
        public readonly ?string $short = null,
        public readonly array $aliases = [],
        public readonly ?string $url = null,
        public readonly ?string $text = null,
        public readonly ?array $data = null,
    ) {
    }

    /** How it reads inside a sentence. */
    public function shortLabel(): string
    {
        return $this->short ?? $this->label;
    }
}
