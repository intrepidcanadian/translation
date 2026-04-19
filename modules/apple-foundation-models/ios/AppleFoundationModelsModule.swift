import ExpoModulesCore

// Conditionally import FoundationModels framework (iOS 26+ / Apple Intelligence era).
// Older SDKs and older runtimes compile the fallback branch which always
// reports unavailable and throws on complete().
#if canImport(FoundationModels)
import FoundationModels
#endif

public class AppleFoundationModelsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleFoundationModels")

    // True iff the device can run on-device LLM prompts right now.
    // Mirrors SystemLanguageModel.default.availability == .available.
    AsyncFunction("isAvailable") { () -> Bool in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return true
        default:
          return false
        }
      }
      #endif
      return false
    }

    // Fine-grained availability for the Settings UI. Maps the framework's
    // Availability enum onto the JS string union. On non-iOS-26 builds or
    // Xcode < 16 the fallback branch returns "notEnabled" — callers treat
    // that as "feature gated off, surface the default hint".
    AsyncFunction("getAvailabilityStatus") { () -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return "available"
        case .unavailable(.deviceNotEligible):
          return "unsupportedDevice"
        case .unavailable(.appleIntelligenceNotEnabled):
          return "notEnabled"
        case .unavailable(.modelNotReady):
          return "modelNotReady"
        case .unavailable:
          return "notEnabled"
        @unknown default:
          return "notEnabled"
        }
      }
      #endif
      return "notEnabled"
    }

    // One-shot prompt completion. The native side handles session lifecycle,
    // decoding, and token accounting; JS callers get a single string back.
    // Throws on unavailability so the JS wrapper can surface a clear error.
    AsyncFunction("complete") { (prompt: String, options: [String: Any]) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard case .available = SystemLanguageModel.default.availability else {
          throw NSError(domain: "AppleFoundationModels", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "Apple Foundation Models not available on this device"
          ])
        }

        let maxTokens = options["maxTokens"] as? Int ?? 512
        let temperature = options["temperature"] as? Double ?? 0.2
        let system = options["system"] as? String

        // Construct the session with an optional system instruction. A short
        // terse instruction performs best with the 3B model — long preambles
        // dilute the prompt and trigger generic outputs.
        let instructions: String
        if let system = system, !system.isEmpty {
          instructions = system
        } else {
          instructions = "You are a concise, factual assistant."
        }

        let session = LanguageModelSession(instructions: instructions)
        let generationOptions = GenerationOptions(
          temperature: temperature,
          maximumResponseTokens: maxTokens
        )

        let response = try await session.respond(to: prompt, options: generationOptions)
        return response.content
      }
      #endif
      throw NSError(domain: "AppleFoundationModels", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Foundation Models framework not available. Requires iOS 26+ with Apple Intelligence enabled."
      ])
    }
  }
}
