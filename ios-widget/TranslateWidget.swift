import WidgetKit
import SwiftUI

// MARK: - Data Model

struct TranslationEntry: TimelineEntry {
    let date: Date
    let original: String
    let translated: String
    let sourceLang: String
    let targetLang: String
    let phraseOfDay: String
    let phraseTranslation: String
}

// MARK: - Timeline Provider

struct TranslationProvider: TimelineProvider {
    private let appGroup = "group.com.tonylau.livetranslator"

    func placeholder(in context: Context) -> TranslationEntry {
        TranslationEntry(
            date: Date(),
            original: "Hello",
            translated: "Hola",
            sourceLang: "EN",
            targetLang: "ES",
            phraseOfDay: "Thank you",
            phraseTranslation: "Gracias"
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (TranslationEntry) -> Void) {
        completion(readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TranslationEntry>) -> Void) {
        let entry = readEntry()
        // Refresh every hour
        let nextUpdate = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func readEntry() -> TranslationEntry {
        let defaults = UserDefaults(suiteName: appGroup)
        return TranslationEntry(
            date: Date(),
            original: defaults?.string(forKey: "lastOriginal") ?? "Tap to translate",
            translated: defaults?.string(forKey: "lastTranslated") ?? "",
            sourceLang: defaults?.string(forKey: "sourceLang") ?? "EN",
            targetLang: defaults?.string(forKey: "targetLang") ?? "ES",
            phraseOfDay: defaults?.string(forKey: "phraseOfDay") ?? "",
            phraseTranslation: defaults?.string(forKey: "phraseTranslation") ?? ""
        )
    }
}

// MARK: - Widget Views

struct TranslateWidgetSmallView: View {
    let entry: TranslationEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Language pair badge
            HStack(spacing: 4) {
                Text(entry.sourceLang)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white)
                Text("\u{2192}")
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.7))
                Text(entry.targetLang)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.purple.opacity(0.8))
            .cornerRadius(8)

            Spacer()

            if !entry.translated.isEmpty {
                // Last translation
                Text(entry.original)
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text(entry.translated)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(2)
            } else {
                Text("Tap to translate")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(12)
        .widgetURL(URL(string: "livetranslator://open"))
    }
}

struct TranslateWidgetMediumView: View {
    let entry: TranslationEntry

    var body: some View {
        HStack(spacing: 12) {
            // Left: Last translation
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text(entry.sourceLang)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                    Text("\u{2192}")
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.7))
                    Text(entry.targetLang)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.purple.opacity(0.8))
                .cornerRadius(8)

                Spacer()

                if !entry.translated.isEmpty {
                    Text(entry.original)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                    Text(entry.translated)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                } else {
                    Text("Tap to translate")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }

            // Right: Phrase of the day
            if !entry.phraseOfDay.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text("Phrase of the Day")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.purple)
                        .textCase(.uppercase)

                    Spacer()

                    Text(entry.phraseOfDay)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                    Text(entry.phraseTranslation)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                }
            }
        }
        .padding(12)
        .widgetURL(URL(string: "livetranslator://open"))
    }
}

// MARK: - Widget Definition

struct TranslateWidget: Widget {
    let kind: String = "TranslateWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TranslationProvider()) { entry in
            if #available(iOS 17.0, *) {
                Group {
                    TranslateWidgetSmallView(entry: entry)
                }
                .containerBackground(.fill.tertiary, for: .widget)
            } else {
                TranslateWidgetSmallView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("Live Translator")
        .description("Quick access to your latest translation and phrase of the day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
