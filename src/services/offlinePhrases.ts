// Built-in offline phrase dictionary organized by category
// Provides basic offline capability without requiring a local ML model

export type PhraseLangCode = "en" | "es" | "fr" | "de" | "it" | "pt" | "ja" | "zh" | "ko" | "ar";

export interface OfflinePhrase extends Record<PhraseLangCode, string> {
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

export type PhraseCategory = "greetings" | "travel" | "emergency" | "food" | "shopping" | "basic" | "numbers" | "directions" | "medical";

export const PHRASE_CATEGORIES: { key: PhraseCategory; label: string; icon: string }[] = [
  { key: "basic", label: "Basic", icon: "💬" },
  { key: "greetings", label: "Greetings", icon: "👋" },
  { key: "travel", label: "Travel", icon: "✈️" },
  { key: "emergency", label: "Emergency", icon: "🚨" },
  { key: "food", label: "Food", icon: "🍽️" },
  { key: "shopping", label: "Shopping", icon: "🛒" },
  { key: "numbers", label: "Numbers", icon: "🔢" },
  { key: "directions", label: "Directions", icon: "🧭" },
  { key: "medical", label: "Medical", icon: "🏥" },
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
  numbers: [
    { en: "Zero", es: "Cero", fr: "Zéro", de: "Null", it: "Zero", pt: "Zero", ja: "零", zh: "零", ko: "영", ar: "صفر" },
    { en: "One", es: "Uno", fr: "Un", de: "Eins", it: "Uno", pt: "Um", ja: "一", zh: "一", ko: "일", ar: "واحد" },
    { en: "Two", es: "Dos", fr: "Deux", de: "Zwei", it: "Due", pt: "Dois", ja: "二", zh: "二", ko: "이", ar: "اثنان" },
    { en: "Three", es: "Tres", fr: "Trois", de: "Drei", it: "Tre", pt: "Três", ja: "三", zh: "三", ko: "삼", ar: "ثلاثة" },
    { en: "Four", es: "Cuatro", fr: "Quatre", de: "Vier", it: "Quattro", pt: "Quatro", ja: "四", zh: "四", ko: "사", ar: "أربعة" },
    { en: "Five", es: "Cinco", fr: "Cinq", de: "Fünf", it: "Cinque", pt: "Cinco", ja: "五", zh: "五", ko: "오", ar: "خمسة" },
    { en: "Ten", es: "Diez", fr: "Dix", de: "Zehn", it: "Dieci", pt: "Dez", ja: "十", zh: "十", ko: "십", ar: "عشرة" },
    { en: "Hundred", es: "Cien", fr: "Cent", de: "Hundert", it: "Cento", pt: "Cem", ja: "百", zh: "百", ko: "백", ar: "مئة" },
    { en: "Thousand", es: "Mil", fr: "Mille", de: "Tausend", it: "Mille", pt: "Mil", ja: "千", zh: "千", ko: "천", ar: "ألف" },
  ],
  directions: [
    { en: "Left", es: "Izquierda", fr: "Gauche", de: "Links", it: "Sinistra", pt: "Esquerda", ja: "左", zh: "左", ko: "왼쪽", ar: "يسار" },
    { en: "Right", es: "Derecha", fr: "Droite", de: "Rechts", it: "Destra", pt: "Direita", ja: "右", zh: "右", ko: "오른쪽", ar: "يمين" },
    { en: "Straight ahead", es: "Todo recto", fr: "Tout droit", de: "Geradeaus", it: "Dritto", pt: "Em frente", ja: "まっすぐ", zh: "直走", ko: "직진", ar: "مستقيم" },
    { en: "Where is the exit?", es: "¿Dónde está la salida?", fr: "Où est la sortie?", de: "Wo ist der Ausgang?", it: "Dov'è l'uscita?", pt: "Onde é a saída?", ja: "出口はどこですか?", zh: "出口在哪里?", ko: "출구가 어디예요?", ar: "أين المخرج؟" },
    { en: "How far is it?", es: "¿Qué tan lejos está?", fr: "C'est loin?", de: "Wie weit ist es?", it: "Quanto è lontano?", pt: "Quão longe é?", ja: "どのくらい遠いですか?", zh: "有多远?", ko: "얼마나 멀어요?", ar: "كم يبعد؟" },
    { en: "Stop here", es: "Pare aquí", fr: "Arrêtez-vous ici", de: "Halten Sie hier", it: "Si fermi qui", pt: "Pare aqui", ja: "ここで止めてください", zh: "在这里停", ko: "여기서 세워주세요", ar: "توقف هنا" },
    { en: "Near", es: "Cerca", fr: "Près", de: "Nah", it: "Vicino", pt: "Perto", ja: "近い", zh: "近", ko: "가까운", ar: "قريب" },
    { en: "Far", es: "Lejos", fr: "Loin", de: "Weit", it: "Lontano", pt: "Longe", ja: "遠い", zh: "远", ko: "먼", ar: "بعيد" },
  ],
  medical: [
    { en: "I need a doctor", es: "Necesito un médico", fr: "J'ai besoin d'un médecin", de: "Ich brauche einen Arzt", it: "Ho bisogno di un medico", pt: "Preciso de um médico", ja: "医者が必要です", zh: "我需要医生", ko: "의사가 필요해요", ar: "أحتاج طبيب" },
    { en: "I feel sick", es: "Me siento mal", fr: "Je me sens mal", de: "Mir ist schlecht", it: "Mi sento male", pt: "Estou me sentindo mal", ja: "気分が悪いです", zh: "我觉得不舒服", ko: "몸이 안 좋아요", ar: "أشعر بالمرض" },
    { en: "It hurts here", es: "Me duele aquí", fr: "J'ai mal ici", de: "Es tut hier weh", it: "Mi fa male qui", pt: "Dói aqui", ja: "ここが痛いです", zh: "这里痛", ko: "여기가 아파요", ar: "يؤلمني هنا" },
    { en: "I am allergic", es: "Soy alérgico", fr: "Je suis allergique", de: "Ich bin allergisch", it: "Sono allergico", pt: "Sou alérgico", ja: "アレルギーがあります", zh: "我过敏", ko: "알레르기가 있어요", ar: "لدي حساسية" },
    { en: "Where is the pharmacy?", es: "¿Dónde está la farmacia?", fr: "Où est la pharmacie?", de: "Wo ist die Apotheke?", it: "Dov'è la farmacia?", pt: "Onde é a farmácia?", ja: "薬局はどこですか?", zh: "药房在哪里?", ko: "약국이 어디예요?", ar: "أين الصيدلية؟" },
    { en: "I need medicine", es: "Necesito medicina", fr: "J'ai besoin de médicaments", de: "Ich brauche Medizin", it: "Ho bisogno di medicine", pt: "Preciso de remédio", ja: "薬が必要です", zh: "我需要药", ko: "약이 필요해요", ar: "أحتاج دواء" },
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
 * Returns a deterministic "phrase of the day" based on the current date.
 * Same phrase is returned all day, changes each day, cycles through all phrases.
 */
export function getPhraseOfTheDay(targetLang: string): { phrase: OfflinePhrase; category: PhraseCategory } | null {
  const tgtLang = targetLang as SupportedLang;
  if (!SUPPORTED_OFFLINE.includes(tgtLang) && targetLang !== "autodetect") return null;

  const now = new Date();
  const dayIndex = Math.floor(now.getTime() / 86400000); // days since epoch
  const index = dayIndex % ALL_PHRASES.length;
  const phrase = ALL_PHRASES[index];

  // Find which category this phrase belongs to
  let category: PhraseCategory = "basic";
  for (const [cat, phrases] of Object.entries(CATEGORIZED_PHRASES)) {
    if (phrases.includes(phrase)) {
      category = cat as PhraseCategory;
      break;
    }
  }

  return { phrase, category };
}

// Common single-word translations for offline word-by-word fallback
const COMMON_WORDS: OfflinePhrase[] = [
  { en: "hello", es: "hola", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", ja: "こんにちは", zh: "你好", ko: "안녕하세요", ar: "مرحبا" },
  { en: "goodbye", es: "adiós", fr: "au revoir", de: "auf wiedersehen", it: "arrivederci", pt: "adeus", ja: "さようなら", zh: "再见", ko: "안녕히 가세요", ar: "وداعا" },
  { en: "good", es: "bueno", fr: "bon", de: "gut", it: "buono", pt: "bom", ja: "良い", zh: "好", ko: "좋은", ar: "جيد" },
  { en: "bad", es: "malo", fr: "mauvais", de: "schlecht", it: "cattivo", pt: "mau", ja: "悪い", zh: "坏", ko: "나쁜", ar: "سيئ" },
  { en: "big", es: "grande", fr: "grand", de: "groß", it: "grande", pt: "grande", ja: "大きい", zh: "大", ko: "큰", ar: "كبير" },
  { en: "small", es: "pequeño", fr: "petit", de: "klein", it: "piccolo", pt: "pequeno", ja: "小さい", zh: "小", ko: "작은", ar: "صغير" },
  { en: "water", es: "agua", fr: "eau", de: "wasser", it: "acqua", pt: "água", ja: "水", zh: "水", ko: "물", ar: "ماء" },
  { en: "food", es: "comida", fr: "nourriture", de: "essen", it: "cibo", pt: "comida", ja: "食べ物", zh: "食物", ko: "음식", ar: "طعام" },
  { en: "money", es: "dinero", fr: "argent", de: "geld", it: "denaro", pt: "dinheiro", ja: "お金", zh: "钱", ko: "돈", ar: "مال" },
  { en: "time", es: "tiempo", fr: "temps", de: "zeit", it: "tempo", pt: "tempo", ja: "時間", zh: "时间", ko: "시간", ar: "وقت" },
  { en: "today", es: "hoy", fr: "aujourd'hui", de: "heute", it: "oggi", pt: "hoje", ja: "今日", zh: "今天", ko: "오늘", ar: "اليوم" },
  { en: "tomorrow", es: "mañana", fr: "demain", de: "morgen", it: "domani", pt: "amanhã", ja: "明日", zh: "明天", ko: "내일", ar: "غدا" },
  { en: "yesterday", es: "ayer", fr: "hier", de: "gestern", it: "ieri", pt: "ontem", ja: "昨日", zh: "昨天", ko: "어제", ar: "أمس" },
  { en: "hot", es: "caliente", fr: "chaud", de: "heiß", it: "caldo", pt: "quente", ja: "暑い", zh: "热", ko: "뜨거운", ar: "حار" },
  { en: "cold", es: "frío", fr: "froid", de: "kalt", it: "freddo", pt: "frio", ja: "寒い", zh: "冷", ko: "차가운", ar: "بارد" },
  { en: "open", es: "abierto", fr: "ouvert", de: "offen", it: "aperto", pt: "aberto", ja: "開いている", zh: "开", ko: "열린", ar: "مفتوح" },
  { en: "closed", es: "cerrado", fr: "fermé", de: "geschlossen", it: "chiuso", pt: "fechado", ja: "閉まっている", zh: "关", ko: "닫힌", ar: "مغلق" },
  { en: "here", es: "aquí", fr: "ici", de: "hier", it: "qui", pt: "aqui", ja: "ここ", zh: "这里", ko: "여기", ar: "هنا" },
  { en: "there", es: "allí", fr: "là", de: "dort", it: "là", pt: "ali", ja: "そこ", zh: "那里", ko: "거기", ar: "هناك" },
  { en: "now", es: "ahora", fr: "maintenant", de: "jetzt", it: "adesso", pt: "agora", ja: "今", zh: "现在", ko: "지금", ar: "الآن" },
  { en: "beautiful", es: "hermoso", fr: "beau", de: "schön", it: "bello", pt: "bonito", ja: "美しい", zh: "美丽", ko: "아름다운", ar: "جميل" },
  { en: "help", es: "ayuda", fr: "aide", de: "hilfe", it: "aiuto", pt: "ajuda", ja: "助けて", zh: "帮助", ko: "도움", ar: "مساعدة" },
  { en: "friend", es: "amigo", fr: "ami", de: "freund", it: "amico", pt: "amigo", ja: "友達", zh: "朋友", ko: "친구", ar: "صديق" },
  { en: "family", es: "familia", fr: "famille", de: "familie", it: "famiglia", pt: "família", ja: "家族", zh: "家庭", ko: "가족", ar: "عائلة" },
  { en: "love", es: "amor", fr: "amour", de: "liebe", it: "amore", pt: "amor", ja: "愛", zh: "爱", ko: "사랑", ar: "حب" },
  { en: "happy", es: "feliz", fr: "heureux", de: "glücklich", it: "felice", pt: "feliz", ja: "幸せ", zh: "快乐", ko: "행복한", ar: "سعيد" },
  { en: "sorry", es: "lo siento", fr: "désolé", de: "entschuldigung", it: "scusa", pt: "desculpa", ja: "ごめんなさい", zh: "对不起", ko: "미안합니다", ar: "آسف" },
  { en: "morning", es: "mañana", fr: "matin", de: "morgen", it: "mattina", pt: "manhã", ja: "朝", zh: "早上", ko: "아침", ar: "صباح" },
  { en: "night", es: "noche", fr: "nuit", de: "nacht", it: "notte", pt: "noite", ja: "夜", zh: "晚上", ko: "밤", ar: "ليل" },
  { en: "eat", es: "comer", fr: "manger", de: "essen", it: "mangiare", pt: "comer", ja: "食べる", zh: "吃", ko: "먹다", ar: "أكل" },
  { en: "drink", es: "beber", fr: "boire", de: "trinken", it: "bere", pt: "beber", ja: "飲む", zh: "喝", ko: "마시다", ar: "شرب" },
  { en: "go", es: "ir", fr: "aller", de: "gehen", it: "andare", pt: "ir", ja: "行く", zh: "去", ko: "가다", ar: "اذهب" },
  { en: "stop", es: "parar", fr: "arrêter", de: "stopp", it: "fermare", pt: "parar", ja: "止まる", zh: "停", ko: "멈추다", ar: "توقف" },
  { en: "wait", es: "esperar", fr: "attendre", de: "warten", it: "aspettare", pt: "esperar", ja: "待つ", zh: "等", ko: "기다리다", ar: "انتظر" },
];

/**
 * Attempt to translate text using the built-in offline phrase dictionary.
 * Returns null if no match is found (caller should fall back to online).
 * Matching is case-insensitive and ignores trailing punctuation.
 * Tries exact phrase match first, then falls back to single-word dictionary.
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

  // Search categorized phrases first (exact phrase match)
  for (const phrase of ALL_PHRASES) {
    if (sourceLang === "autodetect") {
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

  // Fall back to common words dictionary (single word match)
  for (const word of COMMON_WORDS) {
    if (sourceLang === "autodetect") {
      for (const lang of SUPPORTED_OFFLINE) {
        if (word[lang].toLowerCase() === normalized) {
          return word[tgtLang] || null;
        }
      }
    } else {
      const sourceValue = word[srcLang];
      if (sourceValue && sourceValue.toLowerCase() === normalized) {
        return word[tgtLang] || null;
      }
    }
  }

  return null;
}
