import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pubba/pubba.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The trail survives restarts in shared_preferences. It stays on the device.
class PrefsStorage implements TrailStorage {
  PrefsStorage(this.prefs);
  final SharedPreferences prefs;
  @override
  String? getItem(String key) => prefs.getString(key);
  @override
  void setItem(String key, String value) => prefs.setString(key, value);
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Compiled with `npx pubba compile pubba.json --out assets/pubba.bundle.json`.
  final pubba = loadBundle(
    await rootBundle.loadString('assets/pubba.bundle.json'),
  );
  final prefs = await SharedPreferences.getInstance();
  final guide = createGuide(
    pubba,
    trail: Trail(storage: PrefsStorage(prefs)),
    route: (e) => '/item/${e.id}',
    accept: (e) => e.type != 'person',
  );
  runApp(SampleApp(model: GuideModel(pubba, guide)));
}

/// One guide for the whole app, held above the navigator, so it outlives screens.
class GuideModel extends ChangeNotifier {
  GuideModel(this.pubba, this.guide);

  final Pubba pubba;
  final Guide guide;
  final navigator = GlobalKey<NavigatorState>();
  final _stack = <String>[];
  Reply? nudge;
  bool sheetOpen = false;
  Timer? _nudgeTimer;

  /// Every move goes through here, so the trail knows who chose it: the visitor (`via` null) or the guide.
  void go(String id, {String? via}) {
    final e = pubba.graph.find(id);
    if (e == null) return;
    if (via == null) {
      guide.visited(id);
    } else {
      guide.follow(id, via);
    }
    _stack.add(id);
    _stepped();
    navigator.currentState!
        .push(
          MaterialPageRoute(
            builder: (_) => ItemPage(entity: e, model: this),
          ),
        )
        .then((_) {
          _stack.remove(id);
          _stepped();
        });
  }

  /// A nudge only after a step the visitor took themselves; the guide decides if one is due.
  void _stepped() {
    _nudgeTimer?.cancel();
    if (nudge != null) {
      nudge = null;
      notifyListeners();
    }
    if (_stack.isEmpty) return;
    _nudgeTimer = Timer(
      Duration(milliseconds: guide.nudgePolicy.delayMs.round()),
      () {
        nudge = guide.nudge();
        if (nudge != null) {
          notifyListeners();
        }
      },
    );
  }

  /// The dock hides while the guide's sheet is open, so it never covers the sheet.
  void setSheetOpen(bool open) {
    sheetOpen = open;
    notifyListeners();
  }

  void dismissNudge() {
    nudge = null;
    notifyListeners();
  }
}

class SampleApp extends StatelessWidget {
  const SampleApp({super.key, required this.model});
  final GuideModel model;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'pubba sample',
      navigatorKey: model.navigator,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: HomePage(model: model),
      // The guide dock sits over every screen.
      builder: (context, child) => Stack(
        children: [
          child!,
          GuideDock(model: model),
        ],
      ),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.model});
  final GuideModel model;

  @override
  Widget build(BuildContext context) {
    final projects = model.pubba.graph.entities.values
        .where((e) => e.type == 'project')
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text("Nimali's work")),
      body: ListView.separated(
        padding: const EdgeInsets.only(bottom: 96),
        itemCount: projects.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (_, i) => ListTile(
          title: Text(projects[i].label),
          subtitle: Text(projects[i].type),
          onTap: () => model.go(projects[i].id),
        ),
      ),
    );
  }
}

class ItemPage extends StatelessWidget {
  const ItemPage({super.key, required this.entity, required this.model});
  final Entity entity;
  final GuideModel model;

  @override
  Widget build(BuildContext context) {
    final related = model.pubba.related(entity.id, limit: 8);
    return Scaffold(
      appBar: AppBar(title: Text(entity.label)),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          if (entity.text != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(entity.text!),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Semantics(
              header: true,
              child: Text(
                'Related',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
          ),
          for (final r in related) ...[
            ListTile(
              title: Text(r.entity.label),
              subtitle: Text(r.text),
              onTap: () => model.go(r.entity.id, via: 'related'),
            ),
            const Divider(height: 1),
          ],
        ],
      ),
    );
  }
}

/// The chat bubble and the nudge card, drawn over every screen.
class GuideDock extends StatelessWidget {
  const GuideDock({super.key, required this.model});
  final GuideModel model;

  @override
  Widget build(BuildContext context) {
    // Positioned must be the Stack's direct child; only its contents rebuild.
    return Positioned(
      left: 12,
      right: 12,
      bottom: 12 + MediaQuery.of(context).padding.bottom,
      child: ListenableBuilder(
        listenable: model,
        builder: (context, _) => model.sheetOpen
            ? const SizedBox.shrink()
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (model.nudge != null)
                    NudgeCard(model: model, reply: model.nudge!),
                  const SizedBox(height: 12),
                  FloatingActionButton.extended(
                    heroTag: 'guide',
                    icon: const Icon(Icons.chat_bubble),
                    label: const Text('Ask'),
                    onPressed: () {
                      model.guide.opened();
                      model.setSheetOpen(true);
                      showModalBottomSheet<void>(
                        context: model.navigator.currentContext!,
                        isScrollControlled: true,
                        showDragHandle: true,
                        builder: (_) => GuideSheet(model: model),
                      ).whenComplete(() => model.setSheetOpen(false));
                    },
                  ),
                ],
              ),
      ),
    );
  }
}

class NudgeCard extends StatelessWidget {
  const NudgeCard({super.key, required this.model, required this.reply});
  final GuideModel model;
  final Reply reply;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 8, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(liveRegion: true, child: Text(reply.text)),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: model.dismissNudge,
                  child: const Text('Not now'),
                ),
                if (reply.action != null)
                  TextButton(
                    onPressed: () {
                      model.dismissNudge();
                      model.go(reply.action!.id, via: 'suggestion');
                    },
                    child: const Text('Show me'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class GuideSheet extends StatefulWidget {
  const GuideSheet({super.key, required this.model});
  final GuideModel model;
  @override
  State<GuideSheet> createState() => _GuideSheetState();
}

class _GuideSheetState extends State<GuideSheet> {
  final _field = TextEditingController();
  late Reply _reply = widget.model.guide.ask('');

  void _ask(String text) {
    final r = widget.model.guide.ask(text);
    setState(() => _reply = r);
    // The guide doesn't move the visitor; the app performs the action.
    if (r.action != null) {
      Navigator.of(context).pop();
      widget.model.go(r.action!.id, via: 'typed');
    }
  }

  void _tap(GuideChip chip) {
    switch (chip) {
      case EntityChip(:final id):
        Navigator.of(context).pop();
        widget.model.go(id, via: 'chip');
      case QuestionChip(:final question):
        _ask(question);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            liveRegion: true,
            child: Text(
              _reply.text,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in _reply.chips)
                ActionChip(label: Text(c.label), onPressed: () => _tap(c)),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _field,
            textInputAction: TextInputAction.send,
            decoration: const InputDecoration(
              labelText: 'Ask about the work',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (text) {
              _ask(text);
              _field.clear();
            },
          ),
        ],
      ),
    );
  }
}
