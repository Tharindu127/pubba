<?php
// The plugin outside WordPress, to try it without a WordPress install:
//   php -S localhost:8080 examples/wordpress/demo/router.php
// Same core class, widget and styles; this file stands in for the theme and the hooks.

declare(strict_types=1);

use Pubba\CookieTrailStorage;
use Pubba\Pubba;

$plugin = dirname(__DIR__) . '/pubba-guide';
require dirname(__DIR__, 3) . '/packages/php/autoload.php';
require $plugin . '/includes/class-pubba-guide-site.php';

$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/assets/')) {
    $file = $plugin . $path;
    if (!is_file($file)) {
        http_response_code(404);
        return true;
    }
    header('Content-Type: ' . (str_ends_with($file, '.js') ? 'text/javascript' : 'text/css'));
    readfile($file);
    return true;
}

$site = new Pubba_Guide_Site(Pubba::load(file_get_contents($plugin . '/pubba.bundle.json')), new CookieTrailStorage(secure: false));
$esc = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES);

if ($path === '/ask') {
    $body = json_decode((string) file_get_contents('php://input'), true);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($site->ask(is_string($body['q'] ?? null) ? $body['q'] : ''), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return true;
}

$entity = $site->entity_for_path($path);
if ($path !== '/' && $entity === null) {
    http_response_code(404);
}
if ($entity !== null) {
    $via = isset($_GET['pubba_via']) && is_string($_GET['pubba_via']) ? $_GET['pubba_via'] : null;
    $site->record($entity, $via);
}
$title = $entity?->label ?? ($path === '/' ? "Nimali's work" : 'Not found');
$config = [
    'endpoint' => '/ask',
    'nudge' => $entity === null ? null : $site->nudge_for($entity, !isset($_GET['pubba_via'])),
    'nudgeGapMs' => $site->guide()->nudgePolicy->gapMs,
];
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $esc($title) ?></title>
<link rel="stylesheet" href="/assets/guide.css">
<style>
body { font: 17px/1.55 system-ui, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px 20px 120px; color: #1d1d29; }
a { color: #3f3fbf; }
header a { text-decoration: none; font-weight: 600; }
@media (prefers-color-scheme: dark) { body { background: #16161d; color: #ececf4; } a { color: #a9a9ff; } }
</style>
</head>
<body>
<header><a href="/">Nimali Perera</a></header>
<main>
<h1><?= $esc($title) ?></h1>
<?php if ($entity !== null): ?>
    <?php if ($entity->text !== null): ?><p><?= $esc($entity->text) ?></p><?php endif ?>
    <?= Pubba_Guide_Site::list_html('Related', $site->related($entity), $esc) ?>
    <?= Pubba_Guide_Site::list_html('You might like next', $site->next(), $esc) ?>
<?php elseif ($path === '/'): ?>
    <ul>
    <?php foreach ($site->pubba->graph->entities as $e): ?>
        <?php if ($e->type === 'project' && $site->path($e) !== null): ?>
        <li><a href="<?= $esc($site->path($e)) ?>"><?= $esc($e->label) ?></a></li>
        <?php endif ?>
    <?php endforeach ?>
    </ul>
<?php else: ?>
    <p>Nothing here. Try the Ask button.</p>
<?php endif ?>
</main>
<script>window.pubbaGuide = <?= json_encode($config, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
<script src="/assets/guide.js"></script>
</body>
</html>
