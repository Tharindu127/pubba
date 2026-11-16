# Stability

pubba follows [semantic versioning](https://semver.org) from 1.0.0. This page
says what that covers. Anything not listed under "Stable" can change in any
release.

## One version for everything

Every package (npm, PyPI, Maven Central, Swift Package, pub.dev, Packagist)
carries the same version and is released together. Any two packages with the
same major version work together. A bundle compiled by one loads in another,
and the conformance suite holds them to the same answers.

## Stable

A breaking change to any of these needs a new major version:

- **The bundle format.** Format 1 is frozen. A minor release may add optional
  fields, and a runtime ignores fields it doesn't know. So an older runtime
  loads a newer bundle and just skips the newer features. Removing a field,
  renaming one or changing what it means needs format 2 and a major release.
  Every 1.x runtime loads every format 1 bundle.
- **The public API of each runtime**: everything the package exports or marks
  `public`. That means the `Pubba` object (`get`, `search`, `match`,
  `related`, `next`, `intent`, `autocomplete`, `explain`, `spread`, `track`),
  loading bundles, the guide, the trail and its storage, events, intent
  helpers, reasons and templates, the exported text helpers, and the result
  types with their fields. In TypeScript this also covers the package's entry
  points (`pubba`, `pubba/portfolio`, `pubba/eval`, `pubba/exports`,
  `pubba/serve`) and the graph builder.
- **Config**: every documented key of the dataset and the config, with its
  default ([spec/SPEC.md](spec/SPEC.md) section 2).
- **Reasons**: the reason kinds and fields, the template keys and the
  `{tokens}` they fill.
- **Events**: event types and their fields. A minor release may add a field
  or an event type, so listeners should ignore what they don't know.
- **The CLI**: commands, flags and the exit code `pubba lint` and
  `pubba eval` give on failure.
- **`pubba serve` and `pubba mcp`**: the HTTP routes and parameters, the MCP
  tool names and inputs, and the shape of their answers.
- **Evaluation files**: the case files `pubba generate` writes and the
  baseline file `pubba eval` reads.
- **The knowledge file** (`toKnowledge`, format `v: 3`): its keys and the
  layout of `links.edges`. A minor release may add a key; changing or removing
  one needs a new format number and a major release.

## Answers

Ranking, scores and sentences are behaviour, not API, but sites rely on
them, so:

- **Patch releases never change an answer.** Only bug fixes that bring a
  runtime back in line with the spec and the conformance suite.
- **Minor releases may change answers** to make them better, for example a
  tuned weight or a new rule. The changelog lists each such change under
  "Changed answers", and a new setting keeps the old answer when the site
  turns it off.
- Every runtime changes in the same release, and the regenerated conformance
  suite shows exactly which answers moved.

Run `pubba eval` with a baseline in your CI to see what an upgrade changes
on your own content.

## Not covered

- Anything marked internal: names starting with `_`, Kotlin and Swift
  `internal`, PHP methods tagged `@internal`, and any TypeScript file imported
  by path instead of through an entry point.
- The bundle's `compiler` field, the exact wording of lint messages, the
  look of CLI output (apart from `--json` output, which is stable), and the
  example apps and samples.
- The conformance suite's case list. Cases are added and regenerated. Its
  file format and harness ops are stable.

## Deprecation

Before something stable is removed it's marked deprecated for at least one
minor release, with the replacement named in the changelog and in the
warning. It's removed only in the next major release.

## Supported platforms

| Runtime | Minimum |
| --- | --- |
| TypeScript / JavaScript | Node.js 22.6, or any modern browser |
| Python | 3.9 |
| Kotlin / Java | JVM 1.8 (Android included) |
| Swift | Swift 5.9; iOS 13, macOS 10.15, tvOS 13, watchOS 6, visionOS 1 |
| Dart / Flutter | Dart 3.2 |
| PHP | 8.1, with ext-json and ext-mbstring |

Raising a minimum happens only in a minor release, and the changelog says
so.
