import Pubba
import SwiftUI

/// The guide's state for the whole app: one guide, held above the navigation stack, so it outlives screens.
@MainActor
@Observable
final class GuideModel {
    let pubba: Pubba
    let guide: Guide
    var path: [String] = []
    var nudge: Reply?
    var guideOpen = false

    init() {
        // Compiled with `npx pubba compile pubba.json --out PubbaSample/pubba.bundle.json`.
        let url = Bundle.main.url(forResource: "pubba.bundle", withExtension: "json")!
        pubba = try! Pubba.load(try! Data(contentsOf: url))
        guide = Guide(
            pubba,
            trail: Trail(storage: UserDefaultsTrailStorage()),
            route: { "item/\($0.id)" },
            accept: { $0.type != "person" }
        )
    }

    var current: Entity? { path.last.flatMap { pubba.graph.find($0) } }

    /// Every move goes through here, so the trail knows who chose it: the visitor (`via` nil) or the guide.
    func go(_ id: String, via: String?) {
        if let via = via { guide.follow(id, via: via) } else { guide.visited(id) }
        path.append(id)
    }
}

@main
struct PubbaSampleApp: App {
    @State private var model = GuideModel()

    var body: some Scene {
        WindowGroup { ContentView().environment(model) }
    }
}

struct ContentView: View {
    @Environment(GuideModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.path) {
            HomeView()
                .navigationTitle("Nimali's work")
                .navigationDestination(for: String.self) { id in
                    if let e = model.pubba.graph.find(id) { ItemView(entity: e) }
                }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .trailing, spacing: 12) {
                if let n = model.nudge { NudgeCard(reply: n) }
                Button {
                    model.guideOpen = true
                    model.guide.opened()
                } label: {
                    Label("Ask", systemImage: "bubble.left.fill")
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)
                        .background(.tint, in: Capsule())
                        .foregroundStyle(.white)
                }
                .accessibilityLabel("Open the guide")
                .padding(.trailing, 20)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.bottom, 8)
        }
        .sheet(isPresented: $model.guideOpen) { GuideSheet().presentationDetents([.medium, .large]) }
        // A nudge only after a step the visitor took themselves; the guide decides if one is due.
        .task(id: model.path.last) {
            // Only write when it changes: an @Observable write re-renders, and two updates in one frame cancel navigation.
            if model.nudge != nil { model.nudge = nil }
            guard model.path.last != nil else { return }
            try? await Task.sleep(for: .milliseconds(Int(model.guide.nudgePolicy.delayMs)))
            if !Task.isCancelled { model.nudge = model.guide.nudge() }
        }
    }
}

struct HomeView: View {
    @Environment(GuideModel.self) private var model

    var body: some View {
        List(model.pubba.graph.entityOrder.filter { $0.type == "project" }) { e in
            Button { model.go(e.id, via: nil) } label: { Row(title: e.label, subtitle: e.type) }.buttonStyle(.plain)
        }
    }
}

struct ItemView: View {
    @Environment(GuideModel.self) private var model
    let entity: Entity

    var body: some View {
        List {
            if let text = entity.text { Section { Text(text) } }
            Section("Related") {
                ForEach(model.pubba.related(entity.id, limit: 8), id: \.entity.id) { r in
                    Button { model.go(r.entity.id, via: "related") } label: { Row(title: r.entity.label, subtitle: r.text) }.buttonStyle(.plain)
                }
            }
        }
        .navigationTitle(entity.label)
    }
}

struct Row: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).foregroundStyle(.primary)
            Text(subtitle).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

struct NudgeCard: View {
    @Environment(GuideModel.self) private var model
    let reply: Reply

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(reply.text)
            HStack {
                Spacer()
                Button("Not now") { model.nudge = nil }
                if let a = reply.action {
                    Button("Show me") { model.nudge = nil; model.go(a.id, via: "suggestion") }.bold()
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
        .accessibilityElement(children: .contain)
        .onAppear { UIAccessibility.post(notification: .announcement, argument: reply.text) }
    }
}

struct GuideSheet: View {
    @Environment(GuideModel.self) private var model
    @State private var question = ""
    @State private var reply: Reply?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let reply = reply {
                Text(reply.text).font(.body)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(reply.chips) { chip in
                            Button(chip.label) { tap(chip) }.buttonStyle(.bordered)
                        }
                    }
                }
            }
            TextField("Ask about the work", text: $question)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .onSubmit { ask(question); question = "" }
            Spacer()
        }
        .padding()
        .onAppear { reply = model.guide.ask("") }
        .onChange(of: reply?.text) { _, text in
            if let text = text { UIAccessibility.post(notification: .announcement, argument: text) }
        }
    }

    private func ask(_ text: String) {
        let r = model.guide.ask(text)
        reply = r
        // The guide doesn't move the visitor; the app performs the action.
        if let a = r.action {
            model.guideOpen = false
            model.go(a.id, via: "typed")
        }
    }

    private func tap(_ chip: Chip) {
        switch chip {
        case let .entity(c):
            model.guideOpen = false
            model.go(c.id, via: "chip")
        case let .question(q):
            ask(q.question)
        }
    }
}
