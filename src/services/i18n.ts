/**
 * Lightweight UI i18n service.
 *
 * Covers the most user-visible UI strings (buttons, onboarding steps,
 * common labels) in the top app-UI locales. The app already translates
 * user *content* via the translation service — this is separate and
 * handles the shell chrome only.
 *
 * Auto-detects from device locale at module load. Falls back to English
 * for unsupported locales or missing keys.
 */

import * as Localization from "expo-localization";

export type UILocale = "en" | "es" | "fr" | "de" | "zh" | "ja" | "pt";

type Strings = Record<string, string>;

const en: Strings = {
  // Buttons
  "btn.next": "Next",
  "btn.skip": "Skip",
  "btn.getStarted": "Get Started",
  "btn.cancel": "Cancel",
  "btn.save": "Save",
  "btn.delete": "Delete",
  "btn.tryAgain": "Try Again",
  "btn.retry": "Retry",
  "btn.copy": "Copy",
  "btn.share": "Share",
  "btn.close": "Close",

  // Tabs
  "tab.translate": "Translate",
  "tab.scan": "Scan",
  "tab.notes": "Notes",
  "tab.settings": "Settings",

  // Errors
  "err.generic": "Something went wrong",
  "err.screenFailed": "{screen} failed to load",
  "err.offline": "You're offline",
  "err.translationFailed": "Translation failed",

  // Onboarding
  "onb.voice.title": "Voice Translation",
  "onb.voice.desc": "Tap the mic button and speak naturally. Your words are translated in real time as you talk.",
  "onb.conv.title": "Conversation Mode",
  "onb.conv.desc": "Toggle Chat mode for face-to-face conversations. Two mic buttons let each person speak in their language.",
  "onb.phrasebook.title": "Phrasebook",
  "onb.phrasebook.desc": "Browse common phrases by category for instant offline translations. Tap to copy, long-press to hear.",
  "onb.type.title": "Type to Translate",
  "onb.type.desc": "Prefer typing? Use the text input at the bottom to translate written text, with multi-line support.",
  "onb.fav.title": "Favorites & History",
  "onb.fav.desc": "Star translations to bookmark them. Swipe left to delete. Search your full history anytime.",
  "onb.camera.title": "Camera Translate",
  "onb.camera.desc": "Point your camera at any text — signs, menus, documents — and see translations overlaid in real time.",
  "onb.scanner.title": "Smart Scanner",
  "onb.scanner.desc": "6 modes: Document, Receipt, Business Card, Medicine, Menu, and Textbook. Each extracts mode-specific info.",
  "onb.settings.title": "Customize Everything",
  "onb.settings.desc": "Adjust font size, speech speed, theme, haptics, and even switch translation providers in Settings.",

  // Accessibility hints
  "a11y.skipTutorial": "Skip tutorial",
  "a11y.goToStep": "Go to step {n}",
  "a11y.nextTip": "Next tip",
};

const es: Strings = {
  "btn.next": "Siguiente",
  "btn.skip": "Saltar",
  "btn.getStarted": "Empezar",
  "btn.cancel": "Cancelar",
  "btn.save": "Guardar",
  "btn.delete": "Eliminar",
  "btn.tryAgain": "Reintentar",
  "btn.retry": "Reintentar",
  "btn.copy": "Copiar",
  "btn.share": "Compartir",
  "btn.close": "Cerrar",
  "tab.translate": "Traducir",
  "tab.scan": "Escanear",
  "tab.notes": "Notas",
  "tab.settings": "Ajustes",
  "err.generic": "Algo salió mal",
  "err.screenFailed": "No se pudo cargar {screen}",
  "err.offline": "Estás sin conexión",
  "err.translationFailed": "Error de traducción",
  "onb.voice.title": "Traducción por voz",
  "onb.voice.desc": "Toca el micrófono y habla con naturalidad. Tus palabras se traducen en tiempo real.",
  "onb.conv.title": "Modo conversación",
  "onb.conv.desc": "Activa el modo Chat para conversaciones cara a cara con dos micrófonos.",
  "onb.phrasebook.title": "Frases",
  "onb.phrasebook.desc": "Explora frases comunes por categoría para traducciones sin conexión.",
  "onb.type.title": "Escribir para traducir",
  "onb.type.desc": "¿Prefieres escribir? Usa el campo de texto para traducir con soporte multilínea.",
  "onb.fav.title": "Favoritos e historial",
  "onb.fav.desc": "Marca traducciones con una estrella. Desliza para eliminar. Busca tu historial completo.",
  "onb.camera.title": "Traducir con cámara",
  "onb.camera.desc": "Apunta tu cámara a cualquier texto y verás traducciones superpuestas en tiempo real.",
  "onb.scanner.title": "Escáner inteligente",
  "onb.scanner.desc": "6 modos: Documento, Recibo, Tarjeta, Medicina, Menú y Libro.",
  "onb.settings.title": "Personaliza todo",
  "onb.settings.desc": "Ajusta el tamaño de fuente, velocidad, tema, vibraciones y más en Ajustes.",
  "a11y.skipTutorial": "Saltar tutorial",
  "a11y.goToStep": "Ir al paso {n}",
  "a11y.nextTip": "Siguiente consejo",
};

const fr: Strings = {
  "btn.next": "Suivant",
  "btn.skip": "Passer",
  "btn.getStarted": "Commencer",
  "btn.cancel": "Annuler",
  "btn.save": "Enregistrer",
  "btn.delete": "Supprimer",
  "btn.tryAgain": "Réessayer",
  "btn.retry": "Réessayer",
  "btn.copy": "Copier",
  "btn.share": "Partager",
  "btn.close": "Fermer",
  "tab.translate": "Traduire",
  "tab.scan": "Scanner",
  "tab.notes": "Notes",
  "tab.settings": "Réglages",
  "err.generic": "Une erreur est survenue",
  "err.screenFailed": "Échec du chargement de {screen}",
  "err.offline": "Vous êtes hors ligne",
  "err.translationFailed": "Échec de la traduction",
  "onb.voice.title": "Traduction vocale",
  "onb.voice.desc": "Touchez le micro et parlez naturellement. Vos mots sont traduits en temps réel.",
  "onb.conv.title": "Mode conversation",
  "onb.conv.desc": "Activez le mode Chat pour des conversations en face-à-face avec deux micros.",
  "onb.phrasebook.title": "Guide de phrases",
  "onb.phrasebook.desc": "Parcourez les phrases courantes par catégorie pour des traductions hors ligne.",
  "onb.type.title": "Taper pour traduire",
  "onb.type.desc": "Utilisez le champ de texte en bas pour traduire, avec prise en charge multi-lignes.",
  "onb.fav.title": "Favoris et historique",
  "onb.fav.desc": "Marquez les traductions en favoris. Glissez pour supprimer. Recherchez votre historique.",
  "onb.camera.title": "Traduction par caméra",
  "onb.camera.desc": "Pointez votre caméra vers n'importe quel texte pour voir les traductions en temps réel.",
  "onb.scanner.title": "Scanner intelligent",
  "onb.scanner.desc": "6 modes : Document, Reçu, Carte, Médicament, Menu et Manuel.",
  "onb.settings.title": "Tout personnaliser",
  "onb.settings.desc": "Ajustez taille, vitesse, thème, vibrations et plus dans Réglages.",
  "a11y.skipTutorial": "Passer le tutoriel",
  "a11y.goToStep": "Aller à l'étape {n}",
  "a11y.nextTip": "Astuce suivante",
};

const de: Strings = {
  "btn.next": "Weiter",
  "btn.skip": "Überspringen",
  "btn.getStarted": "Loslegen",
  "btn.cancel": "Abbrechen",
  "btn.save": "Speichern",
  "btn.delete": "Löschen",
  "btn.tryAgain": "Erneut versuchen",
  "btn.retry": "Erneut versuchen",
  "btn.copy": "Kopieren",
  "btn.share": "Teilen",
  "btn.close": "Schließen",
  "tab.translate": "Übersetzen",
  "tab.scan": "Scannen",
  "tab.notes": "Notizen",
  "tab.settings": "Einstellungen",
  "err.generic": "Etwas ist schiefgelaufen",
  "err.screenFailed": "{screen} konnte nicht geladen werden",
  "err.offline": "Du bist offline",
  "err.translationFailed": "Übersetzung fehlgeschlagen",
  "onb.voice.title": "Sprachübersetzung",
  "onb.voice.desc": "Tippe auf das Mikrofon und sprich natürlich. Deine Worte werden in Echtzeit übersetzt.",
  "onb.conv.title": "Gesprächsmodus",
  "onb.conv.desc": "Aktiviere den Chat-Modus für Gespräche mit zwei Mikrofonen.",
  "onb.phrasebook.title": "Sprachführer",
  "onb.phrasebook.desc": "Durchsuche häufige Sätze nach Kategorien für Offline-Übersetzungen.",
  "onb.type.title": "Tippen zum Übersetzen",
  "onb.type.desc": "Nutze das Textfeld, um Text mehrzeilig zu übersetzen.",
  "onb.fav.title": "Favoriten & Verlauf",
  "onb.fav.desc": "Markiere Übersetzungen. Wische zum Löschen. Durchsuche deinen Verlauf.",
  "onb.camera.title": "Kameraübersetzung",
  "onb.camera.desc": "Richte die Kamera auf Text und sieh Übersetzungen in Echtzeit.",
  "onb.scanner.title": "Smart-Scanner",
  "onb.scanner.desc": "6 Modi: Dokument, Beleg, Visitenkarte, Medikament, Menü und Lehrbuch.",
  "onb.settings.title": "Alles anpassen",
  "onb.settings.desc": "Passe Schriftgröße, Geschwindigkeit, Thema und Haptik in den Einstellungen an.",
  "a11y.skipTutorial": "Tutorial überspringen",
  "a11y.goToStep": "Zu Schritt {n}",
  "a11y.nextTip": "Nächster Tipp",
};

const zh: Strings = {
  "btn.next": "下一步",
  "btn.skip": "跳过",
  "btn.getStarted": "开始使用",
  "btn.cancel": "取消",
  "btn.save": "保存",
  "btn.delete": "删除",
  "btn.tryAgain": "重试",
  "btn.retry": "重试",
  "btn.copy": "复制",
  "btn.share": "分享",
  "btn.close": "关闭",
  "tab.translate": "翻译",
  "tab.scan": "扫描",
  "tab.notes": "笔记",
  "tab.settings": "设置",
  "err.generic": "出错了",
  "err.screenFailed": "{screen} 加载失败",
  "err.offline": "您已离线",
  "err.translationFailed": "翻译失败",
  "onb.voice.title": "语音翻译",
  "onb.voice.desc": "点击麦克风按钮自然说话。您的话语将实时翻译。",
  "onb.conv.title": "对话模式",
  "onb.conv.desc": "开启聊天模式进行面对面对话,两个麦克风让双方各说各语。",
  "onb.phrasebook.title": "常用短语",
  "onb.phrasebook.desc": "按类别浏览常用短语,即时离线翻译。",
  "onb.type.title": "输入翻译",
  "onb.type.desc": "在底部文本框输入文字进行翻译,支持多行。",
  "onb.fav.title": "收藏与历史",
  "onb.fav.desc": "收藏翻译。左滑删除。随时搜索完整历史。",
  "onb.camera.title": "相机翻译",
  "onb.camera.desc": "将相机对准任何文字,实时查看叠加翻译。",
  "onb.scanner.title": "智能扫描",
  "onb.scanner.desc": "6 种模式:文档、收据、名片、药品、菜单和教科书。",
  "onb.settings.title": "全面定制",
  "onb.settings.desc": "在设置中调整字体大小、语速、主题、触感等。",
  "a11y.skipTutorial": "跳过教程",
  "a11y.goToStep": "转到第 {n} 步",
  "a11y.nextTip": "下一个提示",
};

const ja: Strings = {
  "btn.next": "次へ",
  "btn.skip": "スキップ",
  "btn.getStarted": "始める",
  "btn.cancel": "キャンセル",
  "btn.save": "保存",
  "btn.delete": "削除",
  "btn.tryAgain": "再試行",
  "btn.retry": "再試行",
  "btn.copy": "コピー",
  "btn.share": "共有",
  "btn.close": "閉じる",
  "tab.translate": "翻訳",
  "tab.scan": "スキャン",
  "tab.notes": "ノート",
  "tab.settings": "設定",
  "err.generic": "エラーが発生しました",
  "err.screenFailed": "{screen} の読み込みに失敗しました",
  "err.offline": "オフラインです",
  "err.translationFailed": "翻訳に失敗しました",
  "onb.voice.title": "音声翻訳",
  "onb.voice.desc": "マイクボタンをタップして自然に話してください。リアルタイムで翻訳されます。",
  "onb.conv.title": "会話モード",
  "onb.conv.desc": "対面会話用のチャットモード。2 つのマイクで双方が自分の言語で話せます。",
  "onb.phrasebook.title": "フレーズ集",
  "onb.phrasebook.desc": "カテゴリ別の一般的なフレーズをオフラインで翻訳。",
  "onb.type.title": "入力翻訳",
  "onb.type.desc": "下部のテキスト入力で複数行のテキストを翻訳。",
  "onb.fav.title": "お気に入りと履歴",
  "onb.fav.desc": "翻訳に星を付けて保存。左にスワイプで削除。履歴をいつでも検索。",
  "onb.camera.title": "カメラ翻訳",
  "onb.camera.desc": "カメラを文字に向けると、リアルタイムで翻訳が表示されます。",
  "onb.scanner.title": "スマートスキャナー",
  "onb.scanner.desc": "6 モード: 文書、領収書、名刺、薬、メニュー、教科書。",
  "onb.settings.title": "すべてをカスタマイズ",
  "onb.settings.desc": "設定で文字サイズ、音声速度、テーマ、触覚などを調整。",
  "a11y.skipTutorial": "チュートリアルをスキップ",
  "a11y.goToStep": "ステップ {n} へ",
  "a11y.nextTip": "次のヒント",
};

const pt: Strings = {
  "btn.next": "Próximo",
  "btn.skip": "Pular",
  "btn.getStarted": "Começar",
  "btn.cancel": "Cancelar",
  "btn.save": "Salvar",
  "btn.delete": "Excluir",
  "btn.tryAgain": "Tentar de novo",
  "btn.retry": "Tentar de novo",
  "btn.copy": "Copiar",
  "btn.share": "Compartilhar",
  "btn.close": "Fechar",
  "tab.translate": "Traduzir",
  "tab.scan": "Escanear",
  "tab.notes": "Notas",
  "tab.settings": "Ajustes",
  "err.generic": "Algo deu errado",
  "err.screenFailed": "Falha ao carregar {screen}",
  "err.offline": "Você está offline",
  "err.translationFailed": "Falha na tradução",
  "onb.voice.title": "Tradução por voz",
  "onb.voice.desc": "Toque no microfone e fale naturalmente. Suas palavras são traduzidas em tempo real.",
  "onb.conv.title": "Modo conversa",
  "onb.conv.desc": "Ative o modo Chat para conversas cara a cara com dois microfones.",
  "onb.phrasebook.title": "Livro de frases",
  "onb.phrasebook.desc": "Navegue por frases comuns por categoria para traduções offline.",
  "onb.type.title": "Digitar para traduzir",
  "onb.type.desc": "Use o campo de texto para traduzir com suporte a múltiplas linhas.",
  "onb.fav.title": "Favoritos e histórico",
  "onb.fav.desc": "Marque traduções com estrela. Deslize para excluir. Pesquise seu histórico.",
  "onb.camera.title": "Traduzir por câmera",
  "onb.camera.desc": "Aponte a câmera para qualquer texto e veja traduções sobrepostas em tempo real.",
  "onb.scanner.title": "Scanner inteligente",
  "onb.scanner.desc": "6 modos: Documento, Recibo, Cartão, Medicamento, Menu e Livro.",
  "onb.settings.title": "Personalize tudo",
  "onb.settings.desc": "Ajuste tamanho da fonte, velocidade, tema, vibrações e mais nos Ajustes.",
  "a11y.skipTutorial": "Pular tutorial",
  "a11y.goToStep": "Ir para etapa {n}",
  "a11y.nextTip": "Próxima dica",
};

const LOCALES: Record<UILocale, Strings> = { en, es, fr, de, zh, ja, pt };
export const SUPPORTED_UI_LOCALES: readonly UILocale[] = Object.keys(LOCALES) as UILocale[];

function detectLocale(): UILocale {
  try {
    const locales = Localization.getLocales();
    for (const loc of locales) {
      const code = (loc.languageCode || "").toLowerCase();
      if (code && (code in LOCALES)) return code as UILocale;
    }
  } catch {
    // fall through
  }
  return "en";
}

let currentLocale: UILocale = detectLocale();

export function setUILocale(locale: UILocale | "auto"): void {
  if (locale === "auto") {
    currentLocale = detectLocale();
  } else if (locale in LOCALES) {
    currentLocale = locale;
  }
}

export function getUILocale(): UILocale {
  return currentLocale;
}

/**
 * Per-placeholder-name regex cache for `t()`'s interpolation pass. Building
 * a `new RegExp("\\{name\\}", "g")` per call burns ~1µs per param on every
 * render path that touches a label — fine in isolation, measurable on
 * components that render dozens of labels per frame (HistoryList rows,
 * onboarding swiper). The placeholder set is small and bounded by the
 * number of unique `{name}` tokens across all locale tables, so an
 * unbounded Map is safe.
 *
 * Exposed via `__resetInterpolationRegexCache` for unit tests that need
 * deterministic isolation. Production code never calls it.
 */
const interpolationRegexCache = new Map<string, RegExp>();

function getInterpolationRegex(name: string): RegExp {
  let re = interpolationRegexCache.get(name);
  if (!re) {
    re = new RegExp(`\\{${name}\\}`, "g");
    interpolationRegexCache.set(name, re);
  }
  // Reset lastIndex defensively — a /g regex's lastIndex is process-wide
  // mutable state, and a previous `.exec`/`.test` call (not used here, but
  // a future caller might) could leave it advanced. `.replace` itself
  // resets lastIndex internally, but this guard makes the contract
  // explicit so a future refactor that switches to `matchAll`/`exec`
  // doesn't silently break.
  re.lastIndex = 0;
  return re;
}

export function __resetInterpolationRegexCache(): void {
  interpolationRegexCache.clear();
}

/**
 * Look up a UI string. Falls back to English if the locale lacks the key,
 * then to the key itself.
 *
 * Supports simple {name} interpolation. Parameter values are inserted
 * verbatim — `$&`, `$1`, `$'`, `$\`` and friends are NOT interpreted as
 * replacement tokens (which they would be with a string-form replacement
 * on String.prototype.replace). This matters because user-facing values
 * can contain `$` (e.g. a product name or price like "$5 off"), and those
 * should render literally instead of being substituted for the matched
 * placeholder text. See i18n.test.ts for the regression fence.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const table = LOCALES[currentLocale];
  const fallback = LOCALES.en;
  let str = table[key] ?? fallback[key] ?? key;
  if (params) {
    for (const k in params) {
      const v = params[k];
      if (v === undefined) continue;
      const value = String(v);
      // Function replacement bypasses special-token interpretation ($&, $1, …).
      str = str.replace(getInterpolationRegex(k), () => value);
    }
  }
  return str;
}
