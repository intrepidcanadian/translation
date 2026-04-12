import ExpoModulesCore
import NaturalLanguage

// Conditionally import Translation framework (iOS 17.4+)
#if canImport(Translation)
import Translation
#endif

public class AppleTranslationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleTranslation")

    // Check if Apple's on-device Translation framework is available
    AsyncFunction("isAvailable") { () -> Bool in
      #if canImport(Translation)
      if #available(iOS 17.4, *) {
        return true
      }
      #endif
      return false
    }

    // Translate a single string using Apple's on-device Translation
    AsyncFunction("translate") { (text: String, sourceLanguage: String, targetLanguage: String) -> String in
      #if canImport(Translation)
      if #available(iOS 17.4, *) {
        let sourceLang = Locale.Language(identifier: sourceLanguage)
        let targetLang = Locale.Language(identifier: targetLanguage)

        let session = TranslationSession(
          from: sourceLang,
          to: targetLang
        )

        let response = try await session.translate(text)
        return response.targetText
      }
      #endif
      throw NSError(domain: "AppleTranslation", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Translation framework not available. Requires iOS 17.4+"
      ])
    }

    // Batch translate multiple strings in a single session (more efficient)
    AsyncFunction("translateBatch") { (texts: [String], sourceLanguage: String, targetLanguage: String) -> [String] in
      #if canImport(Translation)
      if #available(iOS 17.4, *) {
        let sourceLang = Locale.Language(identifier: sourceLanguage)
        let targetLang = Locale.Language(identifier: targetLanguage)

        let session = TranslationSession(
          from: sourceLang,
          to: targetLang
        )

        let requests = texts.map { TranslationSession.Request(sourceText: $0) }
        let responses = try await session.translations(from: requests)

        return responses.map { $0.targetText }
      }
      #endif
      throw NSError(domain: "AppleTranslation", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Translation framework not available. Requires iOS 17.4+"
      ])
    }

    // Get list of supported language codes
    AsyncFunction("getSupportedLanguages") { () -> [String] in
      #if canImport(Translation)
      if #available(iOS 17.4, *) {
        let languages = await LanguageAvailability().supportedLanguages
        return languages.map { $0.minimalIdentifier }
      }
      #endif
      return []
    }

    // Download language model for offline use
    AsyncFunction("downloadLanguage") { (languageCode: String) -> Void in
      #if canImport(Translation)
      if #available(iOS 17.4, *) {
        let lang = Locale.Language(identifier: languageCode)
        let availability = LanguageAvailability()
        let status = await availability.status(from: .init(identifier: "en"), to: lang)

        if status == .installed {
          return // Already downloaded
        }

        // Trigger download by creating a session (iOS manages the download)
        let _ = TranslationSession(
          from: .init(identifier: "en"),
          to: lang
        )
        return
      }
      #endif
      throw NSError(domain: "AppleTranslation", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Translation framework not available"
      ])
    }

    // Detect language using Apple's NaturalLanguage framework (runs on Neural Engine)
    AsyncFunction("detectLanguage") { (text: String) -> String? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)

      guard let language = recognizer.dominantLanguage else {
        return nil
      }
      return language.rawValue
    }
  }
}
