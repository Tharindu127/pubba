<?php

declare(strict_types=1);

namespace Pubba;

/** A follow-up button: a place to go (EntityChip) or a question to ask the guide (QuestionChip). */
interface GuideChip
{
    public function label(): string;
}
