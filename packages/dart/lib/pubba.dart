/// pubba: a small brain for showroom sites and apps.
///
/// Load a bundle compiled by `pubba compile` and answer: related items with
/// reasons, what next from a visitor's trail, typo-tolerant matching, a
/// headless guide, and privacy-safe measurement events. Same answers as every
/// other pubba runtime: the conformance suite holds them to it.
library;

export 'src/events.dart' show Events, PubbaEvent, Summary, Track, createEvents, guideVias, summarise;
export 'src/guide.dart';
export 'src/model.dart';
export 'src/pubba.dart' show Pubba, Spread, Why, loadBundle;
export 'src/reasons.dart' show defaultTemplates, reasonFromLink, renderReason;
export 'src/text.dart' show closeTo, containsName, editDistance, hasPhrase, normalize;
export 'src/trail.dart';

/// This runtime's version.
const String version = '0.7.0';
