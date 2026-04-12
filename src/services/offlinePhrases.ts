// Built-in offline phrase dictionary for common translations
// Provides basic offline capability without requiring a local ML model

export interface OfflinePhrase {
  en: string;
  es: string;
  fr: string;
  de: string;
  it: string;
  pt: string;
  ja: string;
  zh: string;
  ko: string;
  ar: string;
}

// Common travel & everyday phrases
const PHRASES: OfflinePhrase[] = [
  {
    en: "Hello", es: "Hola", fr: "Bonjour", de: "Hallo",
    it: "Ciao", pt: "Olá", ja: "こんにちは", zh: "你好", ko: "안녕하세요", ar: "مرحبا",
  },
  {
    en: "Thank you", es: "Gracias", fr: "Merci", de: "Danke",
    it: "Grazie", pt: "Obrigado", ja: "ありがとう", zh: "谢谢", ko: "감사합니다", ar: "شكرا",
  },
  {
    en: "Yes", es: "Sí", fr: "Oui", de: "Ja",
    it: "Sì", pt: "Sim", ja: "はい", zh: "是", ko: "네", ar: "نعم",
  },
  {
    en: "No", es: "No", fr: "Non", de: "Nein",
    it: "No", pt: "Não", ja: "いいえ", zh: "不", ko: "아니요", ar: "لا",
  },
  {
    en: "Please", es: "Por favor", fr: "S'il vous plaît", de: "Bitte",
    it: "Per favore", pt: "Por favor", ja: "お願いします", zh: "请", ko: "부탁합니다", ar: "من فضلك",
  },
  {
    en: "Goodbye", es: "Adiós", fr: "Au revoir", de: "Auf Wiedersehen",
    it: "Arrivederci", pt: "Adeus", ja: "さようなら", zh: "再见", ko: "안녕히 가세요", ar: "مع السلامة",
  },
  {
    en: "Excuse me", es: "Disculpe", fr: "Excusez-moi", de: "Entschuldigung",
    it: "Mi scusi", pt: "Com licença", ja: "すみません", zh: "打扰一下", ko: "실례합니다", ar: "عفوا",
  },
  {
    en: "I don't understand", es: "No entiendo", fr: "Je ne comprends pas", de: "Ich verstehe nicht",
    it: "Non capisco", pt: "Não entendo", ja: "わかりません", zh: "我不明白", ko: "이해하지 못합니다", ar: "لا أفهم",
  },
  {
    en: "How much?", es: "¿Cuánto cuesta?", fr: "Combien?", de: "Wie viel?",
    it: "Quanto costa?", pt: "Quanto custa?", ja: "いくらですか?", zh: "多少钱?", ko: "얼마예요?", ar: "كم الثمن؟",
  },
  {
    en: "Where is the bathroom?", es: "¿Dónde está el baño?", fr: "Où sont les toilettes?", de: "Wo ist die Toilette?",
    it: "Dov'è il bagno?", pt: "Onde é o banheiro?", ja: "トイレはどこですか?", zh: "洗手间在哪里?", ko: "화장실이 어디예요?", ar: "أين الحمام؟",
  },
  {
    en: "Help", es: "Ayuda", fr: "Aide", de: "Hilfe",
    it: "Aiuto", pt: "Ajuda", ja: "助けて", zh: "帮助", ko: "도와주세요", ar: "مساعدة",
  },
  {
    en: "Water", es: "Agua", fr: "Eau", de: "Wasser",
    it: "Acqua", pt: "Água", ja: "水", zh: "水", ko: "물", ar: "ماء",
  },
  {
    en: "Food", es: "Comida", fr: "Nourriture", de: "Essen",
    it: "Cibo", pt: "Comida", ja: "食べ物", zh: "食物", ko: "음식", ar: "طعام",
  },
  {
    en: "I need help", es: "Necesito ayuda", fr: "J'ai besoin d'aide", de: "Ich brauche Hilfe",
    it: "Ho bisogno di aiuto", pt: "Preciso de ajuda", ja: "助けが必要です", zh: "我需要帮助", ko: "도움이 필요합니다", ar: "أحتاج مساعدة",
  },
  {
    en: "Good morning", es: "Buenos días", fr: "Bonjour", de: "Guten Morgen",
    it: "Buongiorno", pt: "Bom dia", ja: "おはようございます", zh: "早上好", ko: "좋은 아침이에요", ar: "صباح الخير",
  },
  {
    en: "Good night", es: "Buenas noches", fr: "Bonne nuit", de: "Gute Nacht",
    it: "Buonanotte", pt: "Boa noite", ja: "おやすみなさい", zh: "晚安", ko: "안녕히 주무세요", ar: "تصبح على خير",
  },
  {
    en: "I'm sorry", es: "Lo siento", fr: "Je suis désolé", de: "Es tut mir leid",
    it: "Mi dispiace", pt: "Desculpe", ja: "ごめんなさい", zh: "对不起", ko: "죄송합니다", ar: "أنا آسف",
  },
  {
    en: "Do you speak English?", es: "¿Habla inglés?", fr: "Parlez-vous anglais?", de: "Sprechen Sie Englisch?",
    it: "Parla inglese?", pt: "Você fala inglês?", ja: "英語を話しますか?", zh: "你会说英语吗?", ko: "영어를 하시나요?", ar: "هل تتحدث الإنجليزية؟",
  },
  {
    en: "Where is the hospital?", es: "¿Dónde está el hospital?", fr: "Où est l'hôpital?", de: "Wo ist das Krankenhaus?",
    it: "Dov'è l'ospedale?", pt: "Onde é o hospital?", ja: "病院はどこですか?", zh: "医院在哪里?", ko: "병원이 어디예요?", ar: "أين المستشفى؟",
  },
  {
    en: "I'm lost", es: "Estoy perdido", fr: "Je suis perdu", de: "Ich habe mich verlaufen",
    it: "Mi sono perso", pt: "Estou perdido", ja: "道に迷いました", zh: "我迷路了", ko: "길을 잃었어요", ar: "أنا تائه",
  },
];

type SupportedLang = keyof OfflinePhrase;
const SUPPORTED_OFFLINE: SupportedLang[] = ["en", "es", "fr", "de", "it", "pt", "ja", "zh", "ko", "ar"];

/**
 * Attempt to translate text using the built-in offline phrase dictionary.
 * Returns null if no match is found (caller should fall back to online).
 * Matching is case-insensitive and ignores trailing punctuation.
 */
export function offlineTranslate(
  text: string,
  sourceLang: string,
  targetLang: string
): string | null {
  const srcLang = sourceLang as SupportedLang;
  const tgtLang = targetLang as SupportedLang;

  if (!SUPPORTED_OFFLINE.includes(srcLang) && sourceLang !== "autodetect") return null;
  if (!SUPPORTED_OFFLINE.includes(tgtLang)) return null;

  const normalized = text.trim().toLowerCase().replace(/[?!.,。？！、]+$/, "");

  for (const phrase of PHRASES) {
    if (sourceLang === "autodetect") {
      // Try to match any source language
      for (const lang of SUPPORTED_OFFLINE) {
        if (phrase[lang].toLowerCase().replace(/[?!.,。？！、]+$/, "") === normalized) {
          return phrase[tgtLang] || null;
        }
      }
    } else {
      const sourceValue = phrase[srcLang];
      if (sourceValue && sourceValue.toLowerCase().replace(/[?!.,。？！、]+$/, "") === normalized) {
        return phrase[tgtLang] || null;
      }
    }
  }

  return null;
}
