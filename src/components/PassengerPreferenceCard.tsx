// PassengerPreferenceCard — Passenger-facing self-service preference picker
// Crew hands the phone to the passenger. Passenger taps dietary preferences,
// allergies, and requests in their own language. Crew sees the summary in English.
// Zero translation needed — all strings are pre-localized.

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Platform,
  SafeAreaView,
} from "react-native";
import { impactLight, impactMedium, notifySuccess } from "../services/haptics";
import { primaryAlpha, type ThemeColors } from "../theme";

// ---------- Localized Strings ----------

type LangCode = "en" | "zh" | "zh-Hant" | "ja" | "ko" | "th" | "vi" | "hi" | "ar" | "fr" | "de" | "es" | "id";

interface LocalizedOption {
  id: string;
  icon: string;
  labels: Record<LangCode, string>;
  englishSummary: string; // What crew sees
}

interface PreferenceCategory {
  id: string;
  icon: string;
  titles: Record<LangCode, string>;
  options: LocalizedOption[];
  multiSelect: boolean;
}

// UI strings for each language
const UI_STRINGS: Record<LangCode, {
  title: string;
  subtitle: string;
  dietary: string;
  allergies: string;
  requests: string;
  submit: string;
  crewView: string;
  backToEdit: string;
  noPreferences: string;
  thankYou: string;
  instruction: string;
}> = {
  en: { title: "Your Preferences", subtitle: "Please select any that apply", dietary: "Dietary", allergies: "Allergies", requests: "Requests", submit: "Submit to Crew", crewView: "Passenger Preferences", backToEdit: "← Back to Edit", noPreferences: "No preferences selected", thankYou: "Thank you! Showing crew now.", instruction: "Tap to select" },
  zh: { title: "您的偏好", subtitle: "请选择适用的选项", dietary: "饮食", allergies: "过敏", requests: "需求", submit: "提交给乘务员", crewView: "旅客偏好", backToEdit: "← 返回修改", noPreferences: "未选择任何偏好", thankYou: "谢谢！正在显示给乘务员。", instruction: "点击选择" },
  "zh-Hant": { title: "您的偏好", subtitle: "請選擇適用的選項", dietary: "飲食", allergies: "過敏", requests: "需求", submit: "提交給空服員", crewView: "旅客偏好", backToEdit: "← 返回修改", noPreferences: "未選擇任何偏好", thankYou: "謝謝！正在顯示給空服員。", instruction: "點擊選擇" },
  ja: { title: "ご要望", subtitle: "該当するものを選択してください", dietary: "食事", allergies: "アレルギー", requests: "リクエスト", submit: "客室乗務員に送信", crewView: "お客様のご要望", backToEdit: "← 編集に戻る", noPreferences: "ご要望が選択されていません", thankYou: "ありがとうございます！乗務員に表示中です。", instruction: "タップして選択" },
  ko: { title: "고객님의 요청사항", subtitle: "해당되는 항목을 선택해주세요", dietary: "식이", allergies: "알레르기", requests: "요청", submit: "승무원에게 제출", crewView: "승객 선호사항", backToEdit: "← 편집으로 돌아가기", noPreferences: "선택된 사항이 없습니다", thankYou: "감사합니다! 승무원에게 표시 중입니다.", instruction: "탭하여 선택" },
  th: { title: "ความต้องการของท่าน", subtitle: "กรุณาเลือกรายการที่ตรงกับท่าน", dietary: "อาหาร", allergies: "อาการแพ้", requests: "คำขอ", submit: "ส่งให้พนักงาน", crewView: "ความต้องการผู้โดยสาร", backToEdit: "← กลับแก้ไข", noPreferences: "ไม่มีรายการที่เลือก", thankYou: "ขอบคุณค่ะ! กำลังแสดงให้พนักงาน", instruction: "แตะเพื่อเลือก" },
  vi: { title: "Yêu cầu của quý khách", subtitle: "Vui lòng chọn các mục phù hợp", dietary: "Chế độ ăn", allergies: "Dị ứng", requests: "Yêu cầu", submit: "Gửi cho tiếp viên", crewView: "Yêu cầu hành khách", backToEdit: "← Quay lại chỉnh sửa", noPreferences: "Chưa chọn yêu cầu nào", thankYou: "Cảm ơn quý khách! Đang hiển thị cho tiếp viên.", instruction: "Chạm để chọn" },
  hi: { title: "आपकी पसंद", subtitle: "कृपया लागू विकल्प चुनें", dietary: "आहार", allergies: "एलर्जी", requests: "अनुरोध", submit: "क्रू को भेजें", crewView: "यात्री वरीयता", backToEdit: "← वापस संपादन", noPreferences: "कोई वरीयता चयनित नहीं", thankYou: "धन्यवाद! क्रू को दिखा रहे हैं।", instruction: "चुनने के लिए टैप करें" },
  ar: { title: "تفضيلاتك", subtitle: "يرجى اختيار ما ينطبق", dietary: "غذائي", allergies: "حساسية", requests: "طلبات", submit: "إرسال لطاقم", crewView: "تفضيلات الراكب", backToEdit: "→ العودة للتعديل", noPreferences: "لم يتم اختيار أي تفضيلات", thankYou: "شكراً! جاري العرض للطاقم.", instruction: "اضغط للاختيار" },
  fr: { title: "Vos préférences", subtitle: "Veuillez sélectionner ce qui s'applique", dietary: "Alimentaire", allergies: "Allergies", requests: "Demandes", submit: "Envoyer à l'équipage", crewView: "Préférences passager", backToEdit: "← Retour à l'édition", noPreferences: "Aucune préférence sélectionnée", thankYou: "Merci ! Affichage pour l'équipage.", instruction: "Appuyez pour sélectionner" },
  de: { title: "Ihre Wünsche", subtitle: "Bitte wählen Sie zutreffende Optionen", dietary: "Ernährung", allergies: "Allergien", requests: "Wünsche", submit: "An Crew senden", crewView: "Passagierwünsche", backToEdit: "← Zurück zur Bearbeitung", noPreferences: "Keine Wünsche ausgewählt", thankYou: "Danke! Wird der Crew angezeigt.", instruction: "Tippen zum Auswählen" },
  es: { title: "Sus preferencias", subtitle: "Seleccione las opciones aplicables", dietary: "Dieta", allergies: "Alergias", requests: "Solicitudes", submit: "Enviar a tripulación", crewView: "Preferencias del pasajero", backToEdit: "← Volver a editar", noPreferences: "Sin preferencias seleccionadas", thankYou: "¡Gracias! Mostrando a la tripulación.", instruction: "Toque para seleccionar" },
  id: { title: "Preferensi Anda", subtitle: "Silakan pilih yang sesuai", dietary: "Makanan", allergies: "Alergi", requests: "Permintaan", submit: "Kirim ke kru", crewView: "Preferensi penumpang", backToEdit: "← Kembali edit", noPreferences: "Tidak ada preferensi dipilih", thankYou: "Terima kasih! Menampilkan ke kru.", instruction: "Ketuk untuk memilih" },
};

// ---------- Preference Data ----------

const DIETARY_OPTIONS: LocalizedOption[] = [
  {
    id: "vegetarian", icon: "🥬",
    labels: { en: "Vegetarian", zh: "素食", "zh-Hant": "素食", ja: "ベジタリアン", ko: "채식", th: "มังสวิรัติ", vi: "Ăn chay", hi: "शाकाहारी", ar: "نباتي", fr: "Végétarien", de: "Vegetarisch", es: "Vegetariano", id: "Vegetarian" },
    englishSummary: "Vegetarian (no meat/fish)",
  },
  {
    id: "vegan", icon: "🌱",
    labels: { en: "Vegan", zh: "纯素", "zh-Hant": "純素", ja: "ヴィーガン", ko: "비건", th: "วีแกน", vi: "Thuần chay", hi: "शुद्ध शाकाहारी", ar: "نباتي صرف", fr: "Végan", de: "Vegan", es: "Vegano", id: "Vegan" },
    englishSummary: "Vegan (no animal products)",
  },
  {
    id: "halal", icon: "☪️",
    labels: { en: "Halal", zh: "清真", "zh-Hant": "清真", ja: "ハラール", ko: "할랄", th: "ฮาลาล", vi: "Halal", hi: "हलाल", ar: "حلال", fr: "Halal", de: "Halal", es: "Halal", id: "Halal" },
    englishSummary: "Halal food required",
  },
  {
    id: "kosher", icon: "✡️",
    labels: { en: "Kosher", zh: "犹太洁食", "zh-Hant": "猶太潔食", ja: "コーシャ", ko: "코셔", th: "โคเชอร์", vi: "Kosher", hi: "कोषेर", ar: "كوشير", fr: "Casher", de: "Koscher", es: "Kosher", id: "Kosher" },
    englishSummary: "Kosher food required",
  },
  {
    id: "no_pork", icon: "🚫🐷",
    labels: { en: "No Pork", zh: "不吃猪肉", "zh-Hant": "不吃豬肉", ja: "豚肉なし", ko: "돼지고기 안됨", th: "ไม่ทานหมู", vi: "Không ăn heo", hi: "सुअर का मांस नहीं", ar: "بدون لحم خنزير", fr: "Sans porc", de: "Kein Schwein", es: "Sin cerdo", id: "Tanpa babi" },
    englishSummary: "No pork",
  },
  {
    id: "no_beef", icon: "🚫🐄",
    labels: { en: "No Beef", zh: "不吃牛肉", "zh-Hant": "不吃牛肉", ja: "牛肉なし", ko: "소고기 안됨", th: "ไม่ทานเนื้อวัว", vi: "Không ăn bò", hi: "गोमांस नहीं", ar: "بدون لحم بقر", fr: "Sans bœuf", de: "Kein Rind", es: "Sin res", id: "Tanpa sapi" },
    englishSummary: "No beef",
  },
  {
    id: "no_seafood", icon: "🚫🐟",
    labels: { en: "No Seafood", zh: "不吃海鲜", "zh-Hant": "不吃海鮮", ja: "シーフードなし", ko: "해산물 안됨", th: "ไม่ทานอาหารทะเล", vi: "Không ăn hải sản", hi: "समुद्री भोजन नहीं", ar: "بدون مأكولات بحرية", fr: "Sans fruits de mer", de: "Keine Meeresfrüchte", es: "Sin mariscos", id: "Tanpa seafood" },
    englishSummary: "No seafood",
  },
  {
    id: "gluten_free", icon: "🌾🚫",
    labels: { en: "Gluten Free", zh: "无麸质", "zh-Hant": "無麩質", ja: "グルテンフリー", ko: "글루텐 프리", th: "ปราศจากกลูเตน", vi: "Không gluten", hi: "ग्लूटेन मुक्त", ar: "خالٍ من الغلوتين", fr: "Sans gluten", de: "Glutenfrei", es: "Sin gluten", id: "Bebas gluten" },
    englishSummary: "Gluten free",
  },
  {
    id: "low_spice", icon: "🌶️❌",
    labels: { en: "Not Spicy", zh: "不辣", "zh-Hant": "不辣", ja: "辛くないもの", ko: "맵지 않은 것", th: "ไม่เผ็ด", vi: "Không cay", hi: "मसालेदार नहीं", ar: "غير حار", fr: "Non épicé", de: "Nicht scharf", es: "No picante", id: "Tidak pedas" },
    englishSummary: "Prefers not spicy food",
  },
  {
    id: "hot_water", icon: "🫖",
    labels: { en: "Hot Water", zh: "热水", "zh-Hant": "熱水", ja: "お湯", ko: "뜨거운 물", th: "น้ำร้อน", vi: "Nước nóng", hi: "गर्म पानी", ar: "ماء ساخن", fr: "Eau chaude", de: "Heißes Wasser", es: "Agua caliente", id: "Air panas" },
    englishSummary: "Wants hot water",
  },
];

const ALLERGY_OPTIONS: LocalizedOption[] = [
  {
    id: "allergy_nuts", icon: "🥜",
    labels: { en: "Nuts", zh: "坚果过敏", "zh-Hant": "堅果過敏", ja: "ナッツ", ko: "견과류", th: "ถั่ว", vi: "Hạt", hi: "मेवे", ar: "مكسرات", fr: "Noix", de: "Nüsse", es: "Frutos secos", id: "Kacang" },
    englishSummary: "⚠️ NUT ALLERGY",
  },
  {
    id: "allergy_dairy", icon: "🥛",
    labels: { en: "Dairy/Lactose", zh: "乳制品过敏", "zh-Hant": "乳製品過敏", ja: "乳製品", ko: "유제품", th: "นม", vi: "Sữa", hi: "डेयरी", ar: "ألبان", fr: "Produits laitiers", de: "Milchprodukte", es: "Lácteos", id: "Susu" },
    englishSummary: "⚠️ DAIRY/LACTOSE ALLERGY",
  },
  {
    id: "allergy_eggs", icon: "🥚",
    labels: { en: "Eggs", zh: "鸡蛋过敏", "zh-Hant": "雞蛋過敏", ja: "卵", ko: "계란", th: "ไข่", vi: "Trứng", hi: "अंडे", ar: "بيض", fr: "Œufs", de: "Eier", es: "Huevos", id: "Telur" },
    englishSummary: "⚠️ EGG ALLERGY",
  },
  {
    id: "allergy_shellfish", icon: "🦐",
    labels: { en: "Shellfish", zh: "贝类过敏", "zh-Hant": "貝類過敏", ja: "甲殻類", ko: "갑각류", th: "หอย/กุ้ง", vi: "Hải sản có vỏ", hi: "शेलफिश", ar: "محار", fr: "Crustacés", de: "Schalentiere", es: "Mariscos", id: "Kerang" },
    englishSummary: "⚠️ SHELLFISH ALLERGY",
  },
  {
    id: "allergy_soy", icon: "🫘",
    labels: { en: "Soy", zh: "大豆过敏", "zh-Hant": "大豆過敏", ja: "大豆", ko: "대두", th: "ถั่วเหลือง", vi: "Đậu nành", hi: "सोया", ar: "صويا", fr: "Soja", de: "Soja", es: "Soja", id: "Kedelai" },
    englishSummary: "⚠️ SOY ALLERGY",
  },
  {
    id: "allergy_wheat", icon: "🌾",
    labels: { en: "Wheat/Gluten", zh: "小麦/麸质过敏", "zh-Hant": "小麥/麩質過敏", ja: "小麦/グルテン", ko: "밀/글루텐", th: "แป้งสาลี", vi: "Lúa mì", hi: "गेहूं/ग्लूटेन", ar: "قمح/غلوتين", fr: "Blé/Gluten", de: "Weizen/Gluten", es: "Trigo/Gluten", id: "Gandum/Gluten" },
    englishSummary: "⚠️ WHEAT/GLUTEN ALLERGY",
  },
];

const REQUEST_OPTIONS: LocalizedOption[] = [
  {
    id: "req_blanket", icon: "🧣",
    labels: { en: "Extra Blanket", zh: "多要一条毯子", "zh-Hant": "多要一條毯子", ja: "毛布を追加", ko: "담요 추가", th: "ผ้าห่มเพิ่ม", vi: "Thêm chăn", hi: "अतिरिक्त कंबल", ar: "بطانية إضافية", fr: "Couverture supplémentaire", de: "Zusätzliche Decke", es: "Manta extra", id: "Selimut tambahan" },
    englishSummary: "Wants extra blanket",
  },
  {
    id: "req_pillow", icon: "🛌",
    labels: { en: "Extra Pillow", zh: "多要一个枕头", "zh-Hant": "多要一個枕頭", ja: "枕を追加", ko: "베개 추가", th: "หมอนเพิ่ม", vi: "Thêm gối", hi: "अतिरिक्त तकिया", ar: "وسادة إضافية", fr: "Oreiller supplémentaire", de: "Zusätzliches Kissen", es: "Almohada extra", id: "Bantal tambahan" },
    englishSummary: "Wants extra pillow",
  },
  {
    id: "req_window_shade", icon: "🪟",
    labels: { en: "Window Shade Down", zh: "请关窗帘", "zh-Hant": "請關窗簾", ja: "日よけを下げて", ko: "창문 가리개 내려주세요", th: "ลดม่านหน้าต่าง", vi: "Hạ rèm cửa sổ", hi: "खिड़की का शेड", ar: "أنزل ستارة النافذة", fr: "Baisser le hublot", de: "Fensterblende runter", es: "Bajar persiana", id: "Turunkan tirai jendela" },
    englishSummary: "Window shade down please",
  },
  {
    id: "req_child_meal", icon: "👶🍽️",
    labels: { en: "Child Meal", zh: "儿童餐", "zh-Hant": "兒童餐", ja: "お子様用メニュー", ko: "어린이 식사", th: "อาหารเด็ก", vi: "Suất ăn trẻ em", hi: "बच्चों का भोजन", ar: "وجبة أطفال", fr: "Repas enfant", de: "Kindermenü", es: "Menú infantil", id: "Makanan anak" },
    englishSummary: "Needs child meal",
  },
  {
    id: "req_medical", icon: "💊",
    labels: { en: "I Have Medication", zh: "我有药物需要", "zh-Hant": "我有藥物需要", ja: "薬があります", ko: "약이 있습니다", th: "มียาที่ต้องทาน", vi: "Tôi có thuốc", hi: "मेरी दवाई है", ar: "لدي أدوية", fr: "J'ai des médicaments", de: "Ich habe Medikamente", es: "Tengo medicamentos", id: "Saya punya obat" },
    englishSummary: "Has medication needs",
  },
  {
    id: "req_wheelchair", icon: "♿",
    labels: { en: "Wheelchair Needed", zh: "需要轮椅", "zh-Hant": "需要輪椅", ja: "車椅子が必要", ko: "휠체어 필요", th: "ต้องการรถเข็น", vi: "Cần xe lăn", hi: "व्हीलचेयर चाहिए", ar: "أحتاج كرسي متحرك", fr: "Fauteuil roulant", de: "Rollstuhl benötigt", es: "Silla de ruedas", id: "Butuh kursi roda" },
    englishSummary: "Wheelchair assistance on arrival",
  },
  {
    id: "req_connecting", icon: "✈️🔗",
    labels: { en: "Tight Connection", zh: "转机时间紧", "zh-Hant": "轉機時間緊", ja: "乗り継ぎが近い", ko: "환승 시간 촉박", th: "ต่อเครื่องเร่งด่วน", vi: "Nối chuyến gấp", hi: "तुरंत कनेक्शन", ar: "اتصال ضيق", fr: "Correspondance serrée", de: "Enger Anschluss", es: "Conexión ajustada", id: "Transit ketat" },
    englishSummary: "Has tight connecting flight",
  },
  {
    id: "req_no_disturb", icon: "😴",
    labels: { en: "Do Not Disturb", zh: "请勿打扰", "zh-Hant": "請勿打擾", ja: "起こさないで", ko: "방해하지 마세요", th: "ห้ามรบกวน", vi: "Không làm phiền", hi: "परेशान न करें", ar: "عدم الإزعاج", fr: "Ne pas déranger", de: "Bitte nicht stören", es: "No molestar", id: "Jangan ganggu" },
    englishSummary: "Do not disturb (wants to sleep)",
  },
  {
    id: "req_duty_free", icon: "🛍️",
    labels: { en: "Duty-Free Shopping", zh: "想购买免税品", "zh-Hant": "想購買免稅品", ja: "免税ショッピング", ko: "면세 쇼핑", th: "ช้อปปิ้งปลอดภาษี", vi: "Mua hàng miễn thuế", hi: "ड्यूटी-फ्री शॉपिंग", ar: "تسوق معفى", fr: "Achats duty-free", de: "Duty-Free Einkauf", es: "Compras duty-free", id: "Belanja duty-free" },
    englishSummary: "Interested in duty-free shopping",
  },
];

const CATEGORIES: PreferenceCategory[] = [
  {
    id: "dietary",
    icon: "🍽️",
    titles: UI_STRINGS.en.dietary ? Object.fromEntries(Object.entries(UI_STRINGS).map(([k, v]) => [k, v.dietary])) as Record<LangCode, string> : {} as Record<LangCode, string>,
    options: DIETARY_OPTIONS,
    multiSelect: true,
  },
  {
    id: "allergies",
    icon: "⚠️",
    titles: Object.fromEntries(Object.entries(UI_STRINGS).map(([k, v]) => [k, v.allergies])) as Record<LangCode, string>,
    options: ALLERGY_OPTIONS,
    multiSelect: true,
  },
  {
    id: "requests",
    icon: "🙋",
    titles: Object.fromEntries(Object.entries(UI_STRINGS).map(([k, v]) => [k, v.requests])) as Record<LangCode, string>,
    options: REQUEST_OPTIONS,
    multiSelect: true,
  },
];

// Available passenger languages
const PASSENGER_LANGUAGES: Array<{ code: LangCode; flag: string; name: string }> = [
  { code: "en", flag: "🇬🇧", name: "English" },
  { code: "zh", flag: "🇨🇳", name: "简体中文" },
  { code: "zh-Hant", flag: "🇭🇰", name: "繁體中文" },
  { code: "ja", flag: "🇯🇵", name: "日本語" },
  { code: "ko", flag: "🇰🇷", name: "한국어" },
  { code: "th", flag: "🇹🇭", name: "ภาษาไทย" },
  { code: "vi", flag: "🇻🇳", name: "Tiếng Việt" },
  { code: "hi", flag: "🇮🇳", name: "हिन्दी" },
  { code: "ar", flag: "🇦🇪", name: "العربية" },
  { code: "id", flag: "🇮🇩", name: "Bahasa" },
  { code: "fr", flag: "🇫🇷", name: "Français" },
  { code: "de", flag: "🇩🇪", name: "Deutsch" },
  { code: "es", flag: "🇪🇸", name: "Español" },
];

// ---------- Component ----------

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  initialLang?: string; // Auto-detect from target language
}

type ViewMode = "language_select" | "preference_select" | "crew_summary";

function PassengerPreferenceCard({ visible, onClose, colors, initialLang }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("language_select");
  const [passengerLang, setPassengerLang] = useState<LangCode>(
    (initialLang as LangCode) ?? "zh"
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const strings = UI_STRINGS[passengerLang] ?? UI_STRINGS.en;

  const handleLanguageSelect = useCallback((lang: LangCode) => {
    impactLight();
    setPassengerLang(lang);
    setViewMode("preference_select");
  }, []);

  const handleToggleOption = useCallback((optionId: string) => {
    impactLight();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    impactMedium();
    notifySuccess();
    setViewMode("crew_summary");
  }, []);

  const handleBack = useCallback(() => {
    setViewMode("preference_select");
  }, []);

  const handleReset = useCallback(() => {
    setSelected(new Set());
    setViewMode("language_select");
  }, []);

  // Collect all selected options for crew summary
  const selectedSummary = useMemo(() => {
    const allOptions = [...DIETARY_OPTIONS, ...ALLERGY_OPTIONS, ...REQUEST_OPTIONS];
    return allOptions.filter((o) => selected.has(o.id));
  }, [selected]);

  const hasAllergies = useMemo(
    () => selectedSummary.some((o) => o.id.startsWith("allergy_")),
    [selectedSummary]
  );

  // ---------- Render Language Selection ----------
  const renderLanguageSelect = () => (
    <View style={styles.langSelectContainer}>
      <Text style={[styles.langSelectTitle, { color: colors.titleText }]}>
        Select Your Language
      </Text>
      <Text style={[styles.langSelectSubtitle, { color: colors.mutedText }]}>
        请选择您的语言 · 言語を選択 · 언어를 선택
      </Text>
      <View style={styles.langGrid}>
        {PASSENGER_LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[styles.langButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
            onPress={() => handleLanguageSelect(lang.code)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${lang.name}`}
            accessibilityHint={`Set passenger language to ${lang.name}`}
          >
            <Text style={styles.langButtonFlag}>{lang.flag}</Text>
            <Text style={[styles.langButtonName, { color: colors.primaryText }]}>{lang.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // ---------- Render Preference Selection (Passenger-facing) ----------
  const renderPreferenceSelect = () => (
    <ScrollView style={styles.prefScroll} contentContainerStyle={styles.prefScrollContent} showsVerticalScrollIndicator={false}>
      {/* Passenger-facing header */}
      <View style={styles.passengerHeader}>
        <Text style={[styles.passengerTitle, { color: colors.titleText }]}>
          {strings.title}
        </Text>
        <Text style={[styles.passengerSubtitle, { color: colors.mutedText }]}>
          {strings.subtitle}
        </Text>
      </View>

      {CATEGORIES.map((category) => (
        <View key={category.id} style={styles.categoryBlock}>
          <Text style={[styles.categoryTitle, { color: colors.primaryText }]}>
            {category.icon} {category.titles[passengerLang] ?? category.titles.en}
          </Text>
          <View style={styles.optionGrid}>
            {category.options.map((option) => {
              const isSelected = selected.has(option.id);
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.optionButton,
                    {
                      backgroundColor: isSelected ? primaryAlpha.faint : colors.cardBg,
                      borderColor: isSelected ? colors.primary : colors.border,
                      borderWidth: isSelected ? 2 : 1,
                    },
                  ]}
                  onPress={() => handleToggleOption(option.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                >
                  <Text style={styles.optionIcon}>{option.icon}</Text>
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: isSelected ? colors.primary : colors.primaryText },
                    ]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {option.labels[passengerLang] ?? option.labels.en}
                  </Text>
                  {isSelected && <Text style={styles.optionCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {/* Submit button */}
      <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: colors.primary, opacity: selected.size > 0 ? 1 : 0.5 }]}
        onPress={handleSubmit}
        disabled={selected.size === 0}
        accessibilityRole="button"
        accessibilityLabel={strings.submit}
        accessibilityHint={selected.size > 0 ? `Submit ${selected.size} selected preferences to crew` : "Select at least one preference first"}
        accessibilityState={{ disabled: selected.size === 0 }}
      >
        <Text style={styles.submitButtonText}>{strings.submit}</Text>
      </TouchableOpacity>

      {selected.size === 0 && (
        <Text style={[styles.noSelectionHint, { color: colors.mutedText }]}>
          {strings.instruction}
        </Text>
      )}
    </ScrollView>
  );

  // ---------- Render Crew Summary ----------
  const renderCrewSummary = () => (
    <ScrollView style={styles.prefScroll} contentContainerStyle={styles.prefScrollContent}>
      {/* Crew-facing: always in English */}
      <View style={styles.crewHeader}>
        <Text style={[styles.crewTitle, { color: colors.titleText }]}>
          ✈️ Passenger Preferences
        </Text>
        <Text style={[styles.crewSeat, { color: colors.mutedText }]}>
          Language: {PASSENGER_LANGUAGES.find((l) => l.code === passengerLang)?.flag}{" "}
          {PASSENGER_LANGUAGES.find((l) => l.code === passengerLang)?.name}
        </Text>
      </View>

      {hasAllergies && (
        <View style={styles.allergyAlert} accessibilityRole="alert" accessibilityLabel="Allergy alert: this passenger has allergy restrictions">
          <Text style={styles.allergyAlertIcon}>⚠️</Text>
          <Text style={styles.allergyAlertText}>ALLERGY ALERT</Text>
        </View>
      )}

      {selectedSummary.length === 0 ? (
        <Text style={[styles.noPrefsText, { color: colors.mutedText }]}>
          No preferences selected
        </Text>
      ) : (
        <View style={styles.summaryList}>
          {selectedSummary.map((opt) => (
            <View
              key={opt.id}
              style={[
                styles.summaryRow,
                {
                  backgroundColor: opt.id.startsWith("allergy_")
                    ? "rgba(255,71,87,0.1)"
                    : colors.cardBg,
                  borderColor: opt.id.startsWith("allergy_")
                    ? "rgba(255,71,87,0.3)"
                    : colors.border,
                },
              ]}
            >
              <Text style={styles.summaryIcon}>{opt.icon}</Text>
              <Text
                style={[
                  styles.summaryText,
                  {
                    color: opt.id.startsWith("allergy_")
                      ? "#ff4757"
                      : colors.primaryText,
                    fontWeight: opt.id.startsWith("allergy_") ? "800" : "600",
                  },
                ]}
              >
                {opt.englishSummary}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.crewActions}>
        <TouchableOpacity
          style={[styles.crewActionBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Edit preferences"
          accessibilityHint="Go back to edit passenger preferences"
        >
          <Text style={[styles.crewActionBtnText, { color: colors.primary }]}>← Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.crewActionBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={handleReset}
          accessibilityRole="button"
          accessibilityLabel="New passenger"
          accessibilityHint="Reset and start fresh for a new passenger"
        >
          <Text style={[styles.crewActionBtnText, { color: colors.primary }]}>🔄 New Passenger</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.containerBg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerClose} accessibilityRole="button" accessibilityLabel="Close passenger preferences">
            <Text style={[styles.headerCloseText, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.titleText }]}>
            {viewMode === "crew_summary" ? "Crew View" : "Passenger Card"}
          </Text>
          <View style={styles.headerClose} />
        </View>

        {viewMode === "language_select" && renderLanguageSelect()}
        {viewMode === "preference_select" && renderPreferenceSelect()}
        {viewMode === "crew_summary" && renderCrewSummary()}
      </SafeAreaView>
    </Modal>
  );
}

export default React.memo(PassengerPreferenceCard);

// ---------- Styles ----------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 8 : 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerClose: { width: 60 },
  headerCloseText: { fontSize: 17, fontWeight: "600" },
  headerTitle: { fontSize: 17, fontWeight: "700", textAlign: "center", flex: 1 },

  // Language selection
  langSelectContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  langSelectTitle: { fontSize: 28, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  langSelectSubtitle: { fontSize: 14, textAlign: "center", marginBottom: 28 },
  langGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  langButton: {
    width: "29%",
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    gap: 6,
  },
  langButtonFlag: { fontSize: 32 },
  langButtonName: { fontSize: 13, fontWeight: "700", textAlign: "center" },

  // Preference selection
  prefScroll: { flex: 1 },
  prefScrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  passengerHeader: {
    alignItems: "center",
    paddingVertical: 16,
  },
  passengerTitle: { fontSize: 24, fontWeight: "800" },
  passengerSubtitle: { fontSize: 14, marginTop: 4 },
  categoryBlock: { marginBottom: 20 },
  categoryTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 8,
    width: "47%",
  },
  optionIcon: { fontSize: 22 },
  optionLabel: { fontSize: 14, fontWeight: "600", flex: 1 },
  optionCheck: { fontSize: 18, color: "#6c63ff", fontWeight: "800" },

  submitButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 20,
  },
  submitButtonText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  noSelectionHint: { textAlign: "center", marginTop: 8, fontSize: 13 },

  // Crew summary
  crewHeader: { paddingVertical: 16, alignItems: "center" },
  crewTitle: { fontSize: 22, fontWeight: "800" },
  crewSeat: { fontSize: 14, marginTop: 4 },
  allergyAlert: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,71,87,0.12)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
    borderWidth: 2,
    borderColor: "#ff4757",
  },
  allergyAlertIcon: { fontSize: 24 },
  allergyAlertText: { fontSize: 18, fontWeight: "900", color: "#ff4757" },
  summaryList: { gap: 8 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  summaryIcon: { fontSize: 24 },
  summaryText: { fontSize: 15, flex: 1 },
  noPrefsText: { textAlign: "center", fontSize: 15, paddingVertical: 20 },
  crewActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 24,
  },
  crewActionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  crewActionBtnText: { fontSize: 15, fontWeight: "700" },
});
