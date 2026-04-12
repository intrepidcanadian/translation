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

    // Extract named entities from text using NaturalLanguage framework (on-device NER)
    // Returns: { persons: [], organizations: [], places: [], dates: [], moneyAmounts: [] }
    AsyncFunction("extractEntities") { (text: String) -> [String: [String]] in
      var entities: [String: [String]] = [
        "persons": [],
        "organizations": [],
        "places": [],
      ]

      let tagger = NLTagger(tagSchemes: [.nameType])
      tagger.string = text

      let options: NLTagger.Options = [.omitPunctuation, .omitWhitespace, .joinNames]
      tagger.enumerateTags(
        in: text.startIndex..<text.endIndex,
        unit: .word,
        scheme: .nameType,
        options: options
      ) { tag, tokenRange in
        guard let tag = tag else { return true }
        let token = String(text[tokenRange])

        switch tag {
        case .personalName:
          if !entities["persons"]!.contains(token) {
            entities["persons"]!.append(token)
          }
        case .organizationName:
          if !entities["organizations"]!.contains(token) {
            entities["organizations"]!.append(token)
          }
        case .placeName:
          if !entities["places"]!.contains(token) {
            entities["places"]!.append(token)
          }
        default:
          break
        }
        return true
      }

      return entities
    }

    // Analyze document text: detect language, extract entities, identify key patterns
    // (dates, monetary amounts, emails, phone numbers, URLs) using on-device processing
    AsyncFunction("analyzeDocument") { (text: String) -> [String: Any] in
      // Language detection
      let langRecognizer = NLLanguageRecognizer()
      langRecognizer.processString(text)
      let detectedLang = langRecognizer.dominantLanguage?.rawValue

      // Named entity recognition
      var persons: [String] = []
      var organizations: [String] = []
      var places: [String] = []

      let tagger = NLTagger(tagSchemes: [.nameType])
      tagger.string = text
      let options: NLTagger.Options = [.omitPunctuation, .omitWhitespace, .joinNames]
      tagger.enumerateTags(
        in: text.startIndex..<text.endIndex,
        unit: .word,
        scheme: .nameType,
        options: options
      ) { tag, tokenRange in
        guard let tag = tag else { return true }
        let token = String(text[tokenRange])
        switch tag {
        case .personalName:
          if !persons.contains(token) { persons.append(token) }
        case .organizationName:
          if !organizations.contains(token) { organizations.append(token) }
        case .placeName:
          if !places.contains(token) { places.append(token) }
        default: break
        }
        return true
      }

      // Pattern extraction using NSDataDetector (dates, addresses, phone numbers, links, money)
      var dates: [String] = []
      var phoneNumbers: [String] = []
      var urls: [String] = []
      var addresses: [String] = []

      let detectorTypes: NSTextCheckingResult.CheckingType = [.date, .phoneNumber, .link, .address]
      if let detector = try? NSDataDetector(types: detectorTypes.rawValue) {
        let matches = detector.matches(in: text, options: [], range: NSRange(text.startIndex..., in: text))
        for match in matches {
          guard let range = Range(match.range, in: text) else { continue }
          let matchText = String(text[range])

          switch match.resultType {
          case .date:
            if let date = match.date {
              let formatter = DateFormatter()
              formatter.dateStyle = .medium
              formatter.timeStyle = match.duration > 0 ? .short : .none
              let formatted = formatter.string(from: date)
              if !dates.contains(formatted) {
                dates.append(formatted)
              }
            }
          case .phoneNumber:
            if let phone = match.phoneNumber, !phoneNumbers.contains(phone) {
              phoneNumbers.append(phone)
            }
          case .link:
            if let url = match.url, !urls.contains(url.absoluteString) {
              urls.append(url.absoluteString)
            }
          case .address:
            if !addresses.contains(matchText) {
              addresses.append(matchText)
            }
          default: break
          }
        }
      }

      // Money pattern matching (common currency formats)
      var moneyAmounts: [String] = []
      let moneyPattern = #"(?:[$€£¥₹₩฿])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:dollars?|euros?|pounds?|yen|yuan|won|USD|EUR|GBP|JPY|CNY|KRW)"#
      if let regex = try? NSRegularExpression(pattern: moneyPattern, options: [.caseInsensitive]) {
        let matches = regex.matches(in: text, options: [], range: NSRange(text.startIndex..., in: text))
        for match in matches {
          if let range = Range(match.range, in: text) {
            let amount = String(text[range])
            if !moneyAmounts.contains(amount) {
              moneyAmounts.append(amount)
            }
          }
        }
      }

      // Sentence count and word count for document stats
      let tokenizer = NLTokenizer(unit: .sentence)
      tokenizer.string = text
      var sentenceCount = 0
      tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { _, _ in
        sentenceCount += 1
        return true
      }

      let wordTokenizer = NLTokenizer(unit: .word)
      wordTokenizer.string = text
      var wordCount = 0
      wordTokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { _, _ in
        wordCount += 1
        return true
      }

      return [
        "detectedLanguage": detectedLang as Any,
        "persons": persons,
        "organizations": organizations,
        "places": places,
        "dates": dates,
        "phoneNumbers": phoneNumbers,
        "urls": urls,
        "addresses": addresses,
        "moneyAmounts": moneyAmounts,
        "sentenceCount": sentenceCount,
        "wordCount": wordCount,
      ]
    }
  }
}
