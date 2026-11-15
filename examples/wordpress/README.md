# WordPress sample

`pubba-guide/` is a WordPress plugin over the example portfolio's bundle:

- **Related**, with the reason for each, under every page that is an entity
  (matched by url path), rendered on the server so it works without JavaScript.
- **`[pubba_next]`**, a shortcode for what this visitor is likely to want next.
- **An Ask guide**: a floating button and panel in plain JavaScript, answered by
  a read-only REST route (`POST /wp-json/pubba/v1/ask`), with chips and nudges.

The trail is a first-party, httpOnly cookie on the visitor's device, recorded on
`template_redirect`. A link the guide sends the visitor along carries
`?pubba_via=`, so the next page records it as followed rather than visited, and
nudges only follow the visitor's own steps. A PHP guide lives for one request,
so the server works out which nudge is due while rendering the page and the
browser decides when to show it.

All the logic is in `includes/class-pubba-guide-site.php`, with no WordPress
calls; `pubba-guide.php` only hooks it in.

## Install

1. Put the runtime in the plugin: `composer require tharindu127/pubba` inside
   `pubba-guide/`, or copy the repository's `packages/php` to
   `pubba-guide/lib/pubba`.
2. Replace `pubba.bundle.json` with your site's bundle (`npx pubba compile`),
   whose entity urls are your permalinks; or point the `pubba_guide_bundle`
   filter at it.
3. Zip `pubba-guide/` and upload it under **Plugins → Add New**, then activate.

Filters: `pubba_guide_bundle` (the bundle path) and `pubba_guide_entity` (the
entity for the current page, if url paths don't match your permalinks).

## Try it without WordPress

`demo/router.php` runs the same class, widget and styles on PHP's built-in
server, with a page for each project:

```bash
php -S localhost:8080 examples/wordpress/demo/router.php
```

Open a project, wait nine seconds for a nudge, and ask "anything like kiri
walet?".
