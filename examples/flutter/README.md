# pubba Flutter sample

A Flutter app over the example portfolio with a pubba guide: a chat bubble that
answers typed questions (typos included), chips to follow, nudges after a pause,
and a visitor trail kept on the device with shared_preferences. It uses the Dart
package from this repository (`packages/dart`).

```bash
flutter run
```

The bundle in `assets/` was compiled with:

```bash
npx pubba compile ../portfolio/pubba.json --out assets/pubba.bundle.json
```

The guide's look is this sample's; pubba itself is headless. Adapt the form to
your app's own design.
