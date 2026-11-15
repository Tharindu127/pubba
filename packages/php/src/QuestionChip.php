<?php

declare(strict_types=1);

namespace Pubba;

/** A question to ask the guide (`$guide->ask($chip->question)` when tapped). */
final class QuestionChip implements GuideChip
{
    public readonly string $question;

    public function __construct(public readonly string $label, ?string $question = null)
    {
        $this->question = $question ?? $label;
    }

    public function label(): string
    {
        return $this->label;
    }
}
