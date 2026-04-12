// Built-in offline phrase dictionary organized by category
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

export type PhraseCategory = "greetings" | "travel" | "emergency" | "food" | "shopping" | "basic";

export const PHRASE_CATEGORIES: { key: PhraseCategory; label: string; icon: string }[] = [
  { key: "basic", label: "Basic", icon: "💬" },
  { key: "greetings", label: "Greetings", icon: "👋" },
  { key: "travel", label: "Travel", icon: "✈️" },
  { key: "emergency", label: "Emergency", icon: "🚨" },
  { key: "food", label: "Food", icon: "🍽️" },
  { key: "shopping", label: "Shopping", icon: "🛒" },
];

const CATEGORIZED_PHRASES: Record<PhraseCategory, OfflinePhrase[]> = {
  basic: [
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
      en: "Thank you", es: "Gracias", fr: "Merci", de: "Danke",
      it: "Grazie", pt: "Obrigado", ja: "ありがとう", zh: "谢谢", ko: "감사합니다", ar: "شكرا",
    },
    {
      en: "Excuse me", es: "Disculpe", fr: "Excusez-moi", de: "Entschuldigung",
      it: "Mi scusi", pt: "Com licença", ja: "すみません", zh: "打扰一下", ko: "실례합니다", ar: "عفوا",
    },
    {
      en: "I'm sorry", es: "Lo siento", fr: "Je suis désolé", de: "Es tut mir leid",
      it: "Mi dispiace", pt: "Desculpe", ja: "ごめんなさい", zh: "对不起", ko: "죄송합니다", ar: "أنا آسف",
    },
    {
      en: "I don't understand", es: "No entiendo", fr: "Je ne comprends pas", de: "Ich verstehe nicht",
      it: "Non capisco", pt: "Não entendo", ja: "わかりません", zh: "我不明白", ko: "이해하지 못합니다", ar: "لا أفهم",
    },
    {
      en: "Do you speak English?", es: "¿Habla inglés?", fr: "Parlez-vous anglais?", de: "Sprechen Sie Englisch?",
      it: "Parla inglese?", pt: "Você fala inglês?", ja: "英語を話しますか?", zh: "你会说英语吗?", ko: "영어를 하시나요?", ar: "هل تتحدث الإنجليزية؟",
    },
  ],
  greetings: [
    {
      en: "Hello", es: "Hola", fr: "Bonjour", de: "Hallo",
      it: "Ciao", pt: "Olá", ja: "こんにちは", zh: "你好", ko: "안녕하세요", ar: "مرحبا",
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
      en: "Goodbye", es: "Adiós", fr: "Au revoir", de: "Auf Wiedersehen",
      it: "Arrivederci", pt: "Adeus", ja: "さようなら", zh: "再见", ko: "안녕히 가세요", ar: "مع السلامة",
    },
    {
      en: "How are you?", es: "¿Cómo estás?", fr: "Comment allez-vous?", de: "Wie geht es Ihnen?",
      it: "Come stai?", pt: "Como vai?", ja: "お元気ですか?", zh: "你好吗?", ko: "어떻게 지내세요?", ar: "كيف حالك؟",
    },
    {
      en: "Nice to meet you", es: "Mucho gusto", fr: "Enchanté", de: "Freut mich",
      it: "Piacere di conoscerti", pt: "Prazer em conhecê-lo", ja: "はじめまして", zh: "很高兴认识你", ko: "만나서 반갑습니다", ar: "سررت بلقائك",
    },
    {
      en: "See you later", es: "Hasta luego", fr: "À bientôt", de: "Bis später",
      it: "A dopo", pt: "Até logo", ja: "また後で", zh: "回头见", ko: "나중에 봐요", ar: "أراك لاحقا",
    },
  ],
  travel: [
    {
      en: "Where is the bathroom?", es: "¿Dónde está el baño?", fr: "Où sont les toilettes?", de: "Wo ist die Toilette?",
      it: "Dov'è il bagno?", pt: "Onde é o banheiro?", ja: "トイレはどこですか?", zh: "洗手间在哪里?", ko: "화장실이 어디예요?", ar: "أين الحمام؟",
    },
    {
      en: "I'm lost", es: "Estoy perdido", fr: "Je suis perdu", de: "Ich habe mich verlaufen",
      it: "Mi sono perso", pt: "Estou perdido", ja: "道に迷いました", zh: "我迷路了", ko: "길을 잃었어요", ar: "أنا تائه",
    },
    {
      en: "How much?", es: "¿Cuánto cuesta?", fr: "Combien?", de: "Wie viel?",
      it: "Quanto costa?", pt: "Quanto custa?", ja: "いくらですか?", zh: "多少钱?", ko: "얼마예요?", ar: "كم الثمن؟",
    },
    {
      en: "Where is the hotel?", es: "¿Dónde está el hotel?", fr: "Où est l'hôtel?", de: "Wo ist das Hotel?",
      it: "Dov'è l'hotel?", pt: "Onde é o hotel?", ja: "ホテルはどこですか?", zh: "酒店在哪里?", ko: "호텔이 어디예요?", ar: "أين الفندق؟",
    },
    {
      en: "I need a taxi", es: "Necesito un taxi", fr: "J'ai besoin d'un taxi", de: "Ich brauche ein Taxi",
      it: "Ho bisogno di un taxi", pt: "Preciso de um táxi", ja: "タクシーが必要です", zh: "我需要出租车", ko: "택시가 필요해요", ar: "أحتاج سيارة أجرة",
    },
    {
      en: "Where is the airport?", es: "¿Dónde está el aeropuerto?", fr: "Où est l'aéroport?", de: "Wo ist der Flughafen?",
      it: "Dov'è l'aeroporto?", pt: "Onde é o aeroporto?", ja: "空港はどこですか?", zh: "机场在哪里?", ko: "공항이 어디예요?", ar: "أين المطار؟",
    },
    {
      en: "Can you help me?", es: "¿Puede ayudarme?", fr: "Pouvez-vous m'aider?", de: "Können Sie mir helfen?",
      it: "Può aiutarmi?", pt: "Pode me ajudar?", ja: "手伝ってもらえますか?", zh: "你能帮我吗?", ko: "도와주실 수 있나요?", ar: "هل يمكنك مساعدتي؟",
    },
  ],
  emergency: [
    {
      en: "Help", es: "Ayuda", fr: "Aide", de: "Hilfe",
      it: "Aiuto", pt: "Ajuda", ja: "助けて", zh: "帮助", ko: "도와주세요", ar: "مساعدة",
    },
    {
      en: "I need help", es: "Necesito ayuda", fr: "J'ai besoin d'aide", de: "Ich brauche Hilfe",
      it: "Ho bisogno di aiuto", pt: "Preciso de ajuda", ja: "助けが必要です", zh: "我需要帮助", ko: "도움이 필요합니다", ar: "أحتاج مساعدة",
    },
    {
      en: "Where is the hospital?", es: "¿Dónde está el hospital?", fr: "Où est l'hôpital?", de: "Wo ist das Krankenhaus?",
      it: "Dov'è l'ospedale?", pt: "Onde é o hospital?", ja: "病院はどこですか?", zh: "医院在哪里?", ko: "병원이 어디예요?", ar: "أين المستشفى؟",
    },
    {
      en: "Call the police", es: "Llame a la policía", fr: "Appelez la police", de: "Rufen Sie die Polizei",
      it: "Chiami la polizia", pt: "Chame a polícia", ja: "警察を呼んでください", zh: "请报警", ko: "경찰을 불러주세요", ar: "اتصل بالشرطة",
    },
    {
      en: "I need a doctor", es: "Necesito un médico", fr: "J'ai besoin d'un médecin", de: "Ich brauche einen Arzt",
      it: "Ho bisogno di un medico", pt: "Preciso de um médico", ja: "医者が必要です", zh: "我需要看医生", ko: "의사가 필요해요", ar: "أحتاج طبيب",
    },
    {
      en: "I'm allergic", es: "Soy alérgico", fr: "Je suis allergique", de: "Ich bin allergisch",
      it: "Sono allergico", pt: "Sou alérgico", ja: "アレルギーがあります", zh: "我过敏", ko: "알레르기가 있어요", ar: "عندي حساسية",
    },
  ],
  food: [
    {
      en: "Water", es: "Agua", fr: "Eau", de: "Wasser",
      it: "Acqua", pt: "Água", ja: "水", zh: "水", ko: "물", ar: "ماء",
    },
    {
      en: "Food", es: "Comida", fr: "Nourriture", de: "Essen",
      it: "Cibo", pt: "Comida", ja: "食べ物", zh: "食物", ko: "음식", ar: "طعام",
    },
    {
      en: "The menu, please", es: "El menú, por favor", fr: "Le menu, s'il vous plaît", de: "Die Speisekarte, bitte",
      it: "Il menu, per favore", pt: "O cardápio, por favor", ja: "メニューをお願いします", zh: "请给我菜单", ko: "메뉴 주세요", ar: "القائمة من فضلك",
    },
    {
      en: "The check, please", es: "La cuenta, por favor", fr: "L'addition, s'il vous plaît", de: "Die Rechnung, bitte",
      it: "Il conto, per favore", pt: "A conta, por favor", ja: "お会計お願いします", zh: "请买单", ko: "계산서 주세요", ar: "الحساب من فضلك",
    },
    {
      en: "I'm vegetarian", es: "Soy vegetariano", fr: "Je suis végétarien", de: "Ich bin Vegetarier",
      it: "Sono vegetariano", pt: "Sou vegetariano", ja: "ベジタリアンです", zh: "我是素食者", ko: "저는 채식주의자예요", ar: "أنا نباتي",
    },
    {
      en: "Delicious", es: "Delicioso", fr: "Délicieux", de: "Köstlich",
      it: "Delizioso", pt: "Delicioso", ja: "おいしい", zh: "好吃", ko: "맛있어요", ar: "لذيذ",
    },
  ],
  shopping: [
    {
      en: "How much?", es: "¿Cuánto cuesta?", fr: "Combien?", de: "Wie viel?",
      it: "Quanto costa?", pt: "Quanto custa?", ja: "いくらですか?", zh: "多少钱?", ko: "얼마예요?", ar: "كم الثمن؟",
    },
    {
      en: "Too expensive", es: "Demasiado caro", fr: "Trop cher", de: "Zu teuer",
      it: "Troppo caro", pt: "Muito caro", ja: "高すぎます", zh: "太贵了", ko: "너무 비싸요", ar: "غالي جدا",
    },
    {
      en: "Do you accept credit cards?", es: "¿Aceptan tarjetas de crédito?", fr: "Acceptez-vous les cartes de crédit?", de: "Akzeptieren Sie Kreditkarten?",
      it: "Accettate carte di credito?", pt: "Aceitam cartão de crédito?", ja: "クレジットカードは使えますか?", zh: "可以刷卡吗?", ko: "카드 결제 되나요?", ar: "هل تقبلون بطاقات الائتمان؟",
    },
    {
      en: "I'm just looking", es: "Solo estoy mirando", fr: "Je regarde seulement", de: "Ich schaue nur",
      it: "Sto solo guardando", pt: "Estou só olhando", ja: "見ているだけです", zh: "我只是看看", ko: "구경만 하고 있어요", ar: "أنا فقط أتفرج",
    },
    {
      en: "Can I try this on?", es: "¿Puedo probármelo?", fr: "Puis-je l'essayer?", de: "Kann ich das anprobieren?",
      it: "Posso provarlo?", pt: "Posso experimentar?", ja: "試着してもいいですか?", zh: "我可以试穿吗?", ko: "입어봐도 될까요?", ar: "هل يمكنني تجربة هذا؟",
    },
  ],
};

// Flat list for backward compatibility with offlineTranslate
const ALL_PHRASES: OfflinePhrase[] = Object.values(CATEGORIZED_PHRASES).flat();

export function getPhrasesForCategory(category: PhraseCategory): OfflinePhrase[] {
  return CATEGORIZED_PHRASES[category] || [];
}

export function getAllCategorizedPhrases(): Record<PhraseCategory, OfflinePhrase[]> {
  return CATEGORIZED_PHRASES;
}

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

  for (const phrase of ALL_PHRASES) {
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
