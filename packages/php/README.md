# pubba for PHP

The [pubba](https://github.com/Tharindu127/pubba) runtime for PHP: load a
bundle compiled by `pubba compile` and answer related items with reasons, what
a visitor is likely to want next, typo-tolerant matching, a headless guide and
privacy-safe measurement events. PHP 8.1+ with only `json` and `mbstring`, so it
runs in WordPress, WooCommerce, Laravel or any PHP site.

It gives the same answers as every other pubba runtime: it passes the shared
conformance suite (4,698 cases) exactly.

```bash
composer require tharindu127/pubba
```

No Composer (many WordPress hosts)? Copy this folder into your plugin or theme
and `require 'pubba/autoload.php';`.

```php
use Pubba\Pubba;
use Pubba\Guide;

$pubba = Pubba::load(file_get_contents(__DIR__ . '/pubba.bundle.json'));

$pubba->match('flutr')->entity?->id;                 // "tech:Flutter"
array_map(fn ($s) => $s->text, $pubba->next(['project:kiri-wallet']));
// ["Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).", ...]

$guide = new Guide($pubba, route: fn ($e) => "/item/{$e->id}");
$reply = $guide->ask('anything like kiri walet?');
$reply->kind; $reply->text; $reply->action?->url;   // "similar", "Kiri Merchant is built on ...", "/item/project:kiri-merchant"
```

The bundle comes from the content, compiled once with the npm package (in your
build, or by whatever publishes your content):

```bash
npx pubba compile pubba.json --out pubba.bundle.json
```

## Keeping the trail between requests

A guide lives for one request; its trail lives in a `TrailStorage`.
`CookieTrailStorage` keeps it in a first-party, httpOnly cookie on the
visitor's device (record steps before any output, since a cookie travels in the
headers); `SessionTrailStorage` keeps it in `$_SESSION`.

```php
use Pubba\CookieTrailStorage;
use Pubba\Trail;

$guide = new Guide($pubba, trail: new Trail(storage: new CookieTrailStorage()));
$guide->visited('project:kiri-wallet');            // the visitor opened it
$guide->follow('project:kiri-merchant', 'chip');   // the guide sent them there
```

## API

| | |
| --- | --- |
| `Pubba::load($json, $events)` | A `Pubba` from a bundle (JSON text, or already decoded) |
| `$pubba->match($query)` | `MatchResult(intent, entity, match, similar, notHere)`; intent is `entity`, `similar` or `none` |
| `$pubba->search($query, limit:, types:)` | Every entity a query could mean, best first (`EntityMatch`, since `match` is a reserved word) |
| `$pubba->next($trail, limit:, exclude:, accept:)` | Predictions: `Suggestion(entity, score, reason, text)` |
| `$pubba->related($id, kinds:, limit:)` | Neighbours, strongest first: `Related(entity, weight, link, reason, text)` |
| `$pubba->autocomplete($typed, trail:, limit:)` | Type-ahead |
| `$pubba->explain($reason, $item)` | A reason as a sentence |
| `$pubba->track->guideOpened() / guidedTo($id, $via) / reached($goal)` | Measurement moments, checked so no visitor text gets in |
| `new Guide($pubba, trail:, route:, chips:, nudge:, prefer:, accept:, fallback:, line:, templates:, now:)` | The headless navigator: `ask`, `chips`, `visited`, `follow`, `nudge`, `opened`, `reached` |
| `new Trail(max:, storage:, key:)` | The visitor's trail; `TrailStorage` has `getItem` / `setItem` |
| `new Events(goals)`, `Events::summarise($events)` | Events (arrays with the spec's field names), and one visit's funnel |

`Reply->chips` holds `EntityChip` (a place to go) and `QuestionChip` (a
question to ask the guide). `Reason` has the same fields as in every runtime;
`$reason->toArray()` gives the JSON shape. Templates may be strings, JSON-shaped
arrays or closures. Behaviour is specified in the repository's `spec/SPEC.md`.

The guide is headless: it returns replies, actions, chips and nudges as data,
and your site draws them. A WordPress plugin (related items under each page,
`[pubba_next]`, and an Ask guide with nudges) is in the repository's
`examples/wordpress`.

## Tests

```bash
php packages/php/tests/run.php   # from the repository root: the conformance suite
```
