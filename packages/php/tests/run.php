<?php

declare(strict_types=1);

// The PHP runtime against the shared conformance suite (../../conformance): php tests/run.php

use Pubba\Events;
use Pubba\Guide;
use Pubba\Pubba;
use Pubba\Tests\Harness;
use Pubba\Text;

require __DIR__ . '/../autoload.php';
require __DIR__ . '/Harness.php';

ini_set('zend.assertions', '1');
$root = getenv('PUBBA_CONFORMANCE') ?: __DIR__ . '/../../../conformance';
$failed = 0;

/** @return list<array<string, mixed>> */
function lines(string $file): array
{
    $out = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES) as $l) {
        if (trim($l) !== '') {
            $out[] = json_decode($l, true, 512, JSON_THROW_ON_ERROR);
        }
    }
    return $out;
}

function check(string $name, bool $ok, string $detail = ''): void
{
    global $failed;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($detail !== '' ? "\n     $detail" : '') . "\n";
    if (!$ok) {
        $failed++;
    }
}

$bad = [];
$text = lines("$root/cases/text.jsonl");
foreach ($text as $c) {
    $got = match ($c['op']) {
        'normalize' => Text::normalize($c['input']),
        'distance' => Text::editDistance($c['a'], $c['b']),
        default => Text::closeTo($c['token'], $c['word'], $c['typoMinLength'] === null ? INF : (float) $c['typoMinLength']),
    };
    $d = Harness::diff($got, $c['expect']);
    if ($d !== null) {
        $bad[] = json_encode($c, JSON_UNESCAPED_UNICODE) . "\n       $d";
    }
}
check('text helpers: ' . count($text) . ' cases', $bad === [], implode("\n     ", array_slice($bad, 0, 5)));

$names = array_map(static fn ($f) => basename($f, '.json'), glob("$root/bundles/*.json"));
sort($names);
check('there are bundles', $names !== []);
$total = count($text);
foreach ($names as $name) {
    $pubba = Pubba::load(file_get_contents("$root/bundles/$name.json"));
    $cases = lines("$root/cases/$name.jsonl");
    $bad = [];
    foreach ($cases as $c) {
        $expect = $c['expect'];
        unset($c['expect']);
        try {
            $d = Harness::diff(Harness::run($pubba, $c), $expect);
        } catch (Throwable $e) {
            $d = 'threw ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine();
        }
        if ($d !== null) {
            $bad[] = substr(json_encode($c, JSON_UNESCAPED_UNICODE), 0, 140) . "\n       $d";
        }
    }
    $total += count($cases);
    check("bundle $name: " . count($cases) . ' cases', $bad === [], $bad === [] ? '' : count($bad) . " differ:\n     " . implode("\n     ", array_slice($bad, 0, 5)));
}

$pubba = Pubba::load(file_get_contents("$root/bundles/portfolio-fiction.json"));
$guide = new Guide($pubba, route: static fn ($e) => "/items/{$e->id}");
$reply = $guide->ask('anything like kiri wallet');
$seen = [];
$events = new Events();
$events->on(static function (array $e) use (&$seen): void {
    $seen[] = $e;
});
$tracked = new Guide($pubba->withEvents($events));
$tracked->follow('project:kiri-merchant', 'typed');
check(
    'the PHP API reads naturally',
    $pubba->match('synthpd')->entity?->id === 'project:synthpad'
        && $reply->kind === 'similar'
        && $reply->action?->url === '/items/project:kiri-merchant'
        && $tracked->trail->get() === ['project:kiri-merchant']
        && Events::summarise($seen)->usedGuide,
);

echo $failed === 0 ? "\nAll $total conformance cases pass.\n" : "\n$failed check(s) failed.\n";
exit($failed === 0 ? 0 : 1);
