# Changelog

## 1.0.0

- First stable release: the public API and bundle format 1 are covered by
  semantic versioning from now on (STABILITY.md in the repository). No API or
  answer changes from 0.9.0.

## 0.9.0

- Intent profiles: `pubba.intent(trail)` reads why a visit is likely happening
  from the bundle's `intents`; `next` leans towards the likely intent by
  default (`intent: null` turns it off), `related` towards a named one, and
  `Reason.intent` marks a suggestion the intent moved. Same answers as every
  other runtime (5,182 conformance cases).

## 0.7.0

- First release of the Dart runtime: loads a pubba bundle and answers like the
  TypeScript, Python, Kotlin and Swift runtimes (match, search, next, related,
  autocomplete, sentences, trail, events, the guide). Pure Dart, no
  dependencies; Dart 3.2+. Passes the shared conformance suite exactly.
