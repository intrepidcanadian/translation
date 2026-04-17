// VisualCardsModal — universal pictogram communication cards for crew-passenger interaction
// Works for ANY language, including unsupported ones. Zero translation needed.
// Organized by cabin scenario: Medical, Meals, Comfort, Safety, Directions, Customs

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  FlatList,
  Dimensions,
  Platform,
} from "react-native";
import * as Speech from "expo-speech";
import { impactLight, notifySuccess } from "../services/haptics";
import type { ThemeColors } from "../theme";

// ---------- Card Data ----------

interface VisualCard {
  id: string;
  icon: string;          // Large pictogram
  label: string;         // English label for crew reference
  phrases: Record<string, string>; // langCode → translation for TTS
}

interface CardCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
  cards: VisualCard[];
}

const CARD_CATEGORIES: CardCategory[] = [
  {
    id: "medical",
    label: "Medical",
    icon: "🏥",
    color: "#ff4757",
    cards: [
      {
        id: "where_pain",
        icon: "🫳👤",
        label: "Where does it hurt?",
        phrases: { en: "Where does it hurt?", zh: "哪里痛？", "zh-Hant": "哪裡痛？", ja: "どこが痛いですか？", ko: "어디가 아프세요?", th: "เจ็บตรงไหน?", vi: "Đau ở đâu?", hi: "कहाँ दर्द हो रहा है?", ar: "أين يؤلمك؟", fr: "Où avez-vous mal ?", de: "Wo tut es weh?", es: "¿Dónde le duele?" },
      },
      {
        id: "medication",
        icon: "💊",
        label: "Do you have medication?",
        phrases: { en: "Do you have your medication with you?", zh: "你有带药吗？", "zh-Hant": "你有帶藥嗎？", ja: "お薬はお持ちですか？", ko: "약을 가지고 계신가요?", th: "คุณมียาติดตัวไหม?", vi: "Bạn có mang theo thuốc không?", hi: "क्या आपके पास दवा है?", ar: "هل لديك دواء معك؟", fr: "Avez-vous vos médicaments ?", de: "Haben Sie Ihre Medikamente dabei?", es: "¿Tiene sus medicamentos?" },
      },
      {
        id: "allergy",
        icon: "⚠️🥜",
        label: "Do you have allergies?",
        phrases: { en: "Do you have any allergies?", zh: "你有过敏吗？", "zh-Hant": "你有過敏嗎？", ja: "アレルギーはありますか？", ko: "알레르기가 있으신가요?", th: "คุณมีอาการแพ้อะไรไหม?", vi: "Bạn có bị dị ứng gì không?", hi: "क्या आपको कोई एलर्जी है?", ar: "هل لديك أي حساسية؟", fr: "Avez-vous des allergies ?", de: "Haben Sie Allergien?", es: "¿Tiene alguna alergia?" },
      },
      {
        id: "doctor",
        icon: "👨‍⚕️",
        label: "We have a doctor on board",
        phrases: { en: "We have a doctor on board who can help.", zh: "机上有医生可以帮助您。", "zh-Hant": "機上有醫生可以幫助您。", ja: "機内に医師がおります。", ko: "기내에 의사가 탑승해 있습니다.", th: "มีแพทย์บนเครื่องที่สามารถช่วยได้", vi: "Chúng tôi có bác sĩ trên máy bay.", hi: "विमान में एक डॉक्टर हैं जो मदद कर सकते हैं।", ar: "لدينا طبيب على متن الطائرة يمكنه المساعدة.", fr: "Nous avons un médecin à bord.", de: "Wir haben einen Arzt an Bord.", es: "Tenemos un médico a bordo." },
      },
      {
        id: "feeling",
        icon: "🤢",
        label: "Are you feeling unwell?",
        phrases: { en: "Are you feeling unwell?", zh: "你不舒服吗？", "zh-Hant": "你不舒服嗎？", ja: "気分が悪いですか？", ko: "몸이 안 좋으신가요?", th: "คุณรู้สึกไม่สบายไหม?", vi: "Bạn có cảm thấy không khỏe không?", hi: "क्या आप अस्वस्थ महसूस कर रहे हैं?", ar: "هل تشعر بتوعك؟", fr: "Vous sentez-vous mal ?", de: "Fühlen Sie sich unwohl?", es: "¿Se siente mal?" },
      },
      {
        id: "pain_scale",
        icon: "😐😣😫",
        label: "Pain level 1-10?",
        phrases: { en: "On a scale of 1 to 10, how bad is the pain?", zh: "疼痛程度1到10，多严重？", "zh-Hant": "疼痛程度1到10，有多嚴重？", ja: "痛みは1から10でどのくらいですか？", ko: "1에서 10까지 통증이 어느 정도인가요?", th: "จาก 1 ถึง 10 ปวดมากแค่ไหน?", vi: "Từ 1 đến 10, mức độ đau bao nhiêu?", hi: "1 से 10 तक दर्द कितना है?", ar: "من 1 إلى 10، ما مدى شدة الألم؟", fr: "Sur une échelle de 1 à 10, quelle est la douleur ?", de: "Auf einer Skala von 1 bis 10, wie stark sind die Schmerzen?", es: "Del 1 al 10, ¿cuánto dolor siente?" },
      },
    ],
  },
  {
    id: "meals",
    label: "Meals",
    icon: "🍽️",
    color: "#ff9f43",
    cards: [
      {
        id: "meal_choice",
        icon: "🐔🐟",
        label: "Chicken or fish?",
        phrases: { en: "Would you like chicken or fish?", zh: "您要鸡肉还是鱼？", "zh-Hant": "您要雞肉還是魚？", ja: "チキンとお魚、どちらになさいますか？", ko: "치킨과 생선 중 어떤 것으로 하시겠어요?", th: "คุณต้องการไก่หรือปลา?", vi: "Quý khách dùng gà hay cá?", hi: "आप चिकन लेंगे या मछली?", ar: "هل تريد دجاج أم سمك؟", fr: "Poulet ou poisson ?", de: "Hähnchen oder Fisch?", es: "¿Pollo o pescado?" },
      },
      {
        id: "drink",
        icon: "🥤",
        label: "What would you like to drink?",
        phrases: { en: "What would you like to drink?", zh: "您想喝什么？", "zh-Hant": "您想喝什麼？", ja: "お飲み物は何になさいますか？", ko: "음료는 무엇으로 하시겠어요?", th: "คุณต้องการดื่มอะไร?", vi: "Quý khách muốn uống gì?", hi: "आप क्या पीना चाहेंगे?", ar: "ماذا تريد أن تشرب؟", fr: "Que souhaitez-vous boire ?", de: "Was möchten Sie trinken?", es: "¿Qué desea beber?" },
      },
      {
        id: "special_meal",
        icon: "🥗✡️☪️",
        label: "Special meal request?",
        phrases: { en: "Do you have a special meal request?", zh: "您有特殊餐食需求吗？", "zh-Hant": "您有特殊餐食需求嗎？", ja: "特別なお食事のご要望はありますか？", ko: "특별 기내식 요청이 있으신가요?", th: "คุณมีคำขอเรื่องอาหารพิเศษไหม?", vi: "Quý khách có yêu cầu suất ăn đặc biệt không?", hi: "क्या आपका कोई विशेष भोजन अनुरोध है?", ar: "هل لديك طلب وجبة خاصة؟", fr: "Avez-vous une demande de repas spécial ?", de: "Haben Sie einen speziellen Essenswunsch?", es: "¿Tiene alguna solicitud de comida especial?" },
      },
      {
        id: "water",
        icon: "💧",
        label: "Would you like water?",
        phrases: { en: "Would you like some water?", zh: "您要喝水吗？", "zh-Hant": "您要喝水嗎？", ja: "お水はいかがですか？", ko: "물을 드시겠어요?", th: "ต้องการน้ำไหม?", vi: "Quý khách có muốn nước không?", hi: "क्या आपको पानी चाहिए?", ar: "هل تريد بعض الماء؟", fr: "Voulez-vous de l'eau ?", de: "Möchten Sie Wasser?", es: "¿Desea agua?" },
      },
      {
        id: "tea_coffee",
        icon: "☕🍵",
        label: "Tea or coffee?",
        phrases: { en: "Would you like tea or coffee?", zh: "您要茶还是咖啡？", "zh-Hant": "您要茶還是咖啡？", ja: "お茶とコーヒー、どちらになさいますか？", ko: "차와 커피 중 어떤 것으로 하시겠어요?", th: "ต้องการชาหรือกาแฟ?", vi: "Quý khách dùng trà hay cà phê?", hi: "आप चाय लेंगे या कॉफ़ी?", ar: "هل تريد شاي أو قهوة؟", fr: "Thé ou café ?", de: "Tee oder Kaffee?", es: "¿Té o café?" },
      },
      {
        id: "meal_done",
        icon: "🫙",
        label: "May I clear your tray?",
        phrases: { en: "May I clear your tray?", zh: "我可以收您的餐盘吗？", "zh-Hant": "我可以收您的餐盤嗎？", ja: "トレーをお下げしてもよろしいですか？", ko: "식판을 치워드릴까요?", th: "ขอเก็บถาดได้ไหม?", vi: "Tôi dọn khay cho quý khách nhé?", hi: "क्या मैं आपकी ट्रे ले जाऊँ?", ar: "هل يمكنني مسح الصينية؟", fr: "Puis-je débarrasser votre plateau ?", de: "Darf ich Ihr Tablett abräumen?", es: "¿Puedo retirar su bandeja?" },
      },
    ],
  },
  {
    id: "safety",
    label: "Safety",
    icon: "🛡️",
    color: "#ee5a24",
    cards: [
      {
        id: "seatbelt",
        icon: "🪢",
        label: "Please fasten your seatbelt",
        phrases: { en: "Please fasten your seatbelt.", zh: "请系好安全带。", "zh-Hant": "請繫好安全帶。", ja: "シートベルトをお締めください。", ko: "안전벨트를 매주세요.", th: "กรุณารัดเข็มขัดนิรภัย", vi: "Vui lòng thắt dây an toàn.", hi: "कृपया अपनी सीट बेल्ट बांध लें।", ar: "يرجى ربط حزام الأمان.", fr: "Veuillez attacher votre ceinture.", de: "Bitte schnallen Sie sich an.", es: "Por favor, abróchese el cinturón." },
      },
      {
        id: "turbulence",
        icon: "⚡✈️",
        label: "Turbulence — please stay seated",
        phrases: { en: "We are experiencing turbulence. Please remain seated with your seatbelt fastened.", zh: "我们正经历颠簸，请坐好并系好安全带。", "zh-Hant": "我們正經歷亂流，請坐好並繫好安全帶。", ja: "揺れが発生しています。シートベルトを締めてお座りください。", ko: "난기류가 발생하고 있습니다. 좌석에 앉아 안전벨트를 매주세요.", th: "เรากำลังเจออากาศแปรปรวน กรุณานั่งและรัดเข็มขัดนิรภัย", vi: "Máy bay đang gặp nhiễu động. Xin quý khách ngồi yên và thắt dây an toàn.", hi: "हम अशांति का अनुभव कर रहे हैं। कृपया सीट बेल्ट बांधकर बैठे रहें।", ar: "نحن نمر بمطبات هوائية. يرجى البقاء جالساً مع ربط حزام الأمان.", fr: "Nous traversons des turbulences. Veuillez rester assis.", de: "Wir erleben Turbulenzen. Bitte bleiben Sie angeschnallt sitzen.", es: "Estamos experimentando turbulencia. Por favor permanezca sentado." },
      },
      {
        id: "seat_upright",
        icon: "💺⬆️",
        label: "Please return your seat to upright",
        phrases: { en: "Please return your seat to the upright position.", zh: "请将座椅调回直立位置。", "zh-Hant": "請將座椅調回直立位置。", ja: "座席を元の位置にお戻しください。", ko: "좌석을 원래 위치로 돌려주세요.", th: "กรุณาปรับเบาะนั่งให้ตั้งตรง", vi: "Vui lòng đưa ghế về vị trí thẳng.", hi: "कृपया अपनी सीट को सीधी स्थिति में लाएं।", ar: "يرجى إعادة مقعدك إلى وضعه المستقيم.", fr: "Veuillez redresser votre siège.", de: "Bitte bringen Sie Ihren Sitz in die aufrechte Position.", es: "Por favor, coloque su asiento en posición vertical." },
      },
      {
        id: "window_shade",
        icon: "🪟⬆️",
        label: "Please open your window shade",
        phrases: { en: "Please open your window shade for landing.", zh: "请打开遮阳板准备降落。", "zh-Hant": "請打開遮陽板準備降落。", ja: "着陸に備えて窓のシェードを開けてください。", ko: "착륙을 위해 창문 덮개를 열어주세요.", th: "กรุณาเปิดม่านหน้าต่างเพื่อการลงจอด", vi: "Vui lòng mở tấm che cửa sổ để hạ cánh.", hi: "कृपया लैंडिंग के लिए अपनी खिड़की का शेड खोलें।", ar: "يرجى فتح غطاء النافذة للهبوط.", fr: "Veuillez ouvrir votre hublot pour l'atterrissage.", de: "Bitte öffnen Sie die Fensterblende für die Landung.", es: "Por favor, abra la ventanilla para el aterrizaje." },
      },
      {
        id: "electronic_devices",
        icon: "📱✈️",
        label: "Switch to airplane mode",
        phrases: { en: "Please switch your device to airplane mode.", zh: "请将设备切换到飞行模式。", "zh-Hant": "請將裝置切換到飛航模式。", ja: "機内モードに切り替えてください。", ko: "기기를 비행기 모드로 전환해 주세요.", th: "กรุณาเปลี่ยนอุปกรณ์เป็นโหมดเครื่องบิน", vi: "Vui lòng chuyển thiết bị sang chế độ máy bay.", hi: "कृपया अपने डिवाइस को एयरप्लेन मोड पर स्विच करें।", ar: "يرجى تحويل جهازك إلى وضع الطيران.", fr: "Veuillez mettre votre appareil en mode avion.", de: "Bitte schalten Sie Ihr Gerät in den Flugmodus.", es: "Por favor, active el modo avión." },
      },
    ],
  },
  {
    id: "comfort",
    label: "Comfort",
    icon: "🛋️",
    color: "#6c63ff",
    cards: [
      {
        id: "blanket",
        icon: "🛏️",
        label: "Would you like a blanket?",
        phrases: { en: "Would you like a blanket?", zh: "您需要毯子吗？", "zh-Hant": "您需要毯子嗎？", ja: "ブランケットはいかがですか？", ko: "담요가 필요하신가요?", th: "ต้องการผ้าห่มไหม?", vi: "Quý khách có cần chăn không?", hi: "क्या आपको कंबल चाहिए?", ar: "هل تريد بطانية؟", fr: "Voulez-vous une couverture ?", de: "Möchten Sie eine Decke?", es: "¿Desea una manta?" },
      },
      {
        id: "pillow",
        icon: "🛌",
        label: "Would you like a pillow?",
        phrases: { en: "Would you like a pillow?", zh: "您需要枕头吗？", "zh-Hant": "您需要枕頭嗎？", ja: "枕はいかがですか？", ko: "베개가 필요하신가요?", th: "ต้องการหมอนไหม?", vi: "Quý khách có cần gối không?", hi: "क्या आपको तकिया चाहिए?", ar: "هل تريد وسادة؟", fr: "Voulez-vous un oreiller ?", de: "Möchten Sie ein Kissen?", es: "¿Desea una almohada?" },
      },
      {
        id: "lavatory",
        icon: "🚻",
        label: "Lavatory is this way",
        phrases: { en: "The lavatory is at the back of the aircraft.", zh: "洗手间在飞机后方。", "zh-Hant": "洗手間在飛機後方。", ja: "お手洗いは機内後方にございます。", ko: "화장실은 기내 뒤쪽에 있습니다.", th: "ห้องน้ำอยู่ด้านหลังเครื่องบิน", vi: "Nhà vệ sinh ở phía sau máy bay.", hi: "शौचालय विमान के पीछे है।", ar: "دورة المياه في مؤخرة الطائرة.", fr: "Les toilettes sont à l'arrière de l'avion.", de: "Die Toilette befindet sich im hinteren Teil des Flugzeugs.", es: "El baño está en la parte trasera del avión." },
      },
      {
        id: "headphones",
        icon: "🎧",
        label: "Here are your headphones",
        phrases: { en: "Here are your headphones for the entertainment system.", zh: "这是您的耳机，用于娱乐系统。", "zh-Hant": "這是您的耳機，用於娛樂系統。", ja: "機内エンターテイメント用のヘッドフォンです。", ko: "기내 엔터테인먼트용 헤드폰입니다.", th: "นี่คือหูฟังสำหรับระบบบันเทิง", vi: "Đây là tai nghe cho hệ thống giải trí.", hi: "यह मनोरंजन प्रणाली के लिए आपका हेडफोन है।", ar: "هذه سماعات الرأس لنظام الترفيه.", fr: "Voici vos écouteurs pour le système de divertissement.", de: "Hier sind Ihre Kopfhörer für das Unterhaltungssystem.", es: "Aquí están sus auriculares para el sistema de entretenimiento." },
      },
    ],
  },
  {
    id: "directions",
    label: "Directions",
    icon: "🧭",
    color: "#26de81",
    cards: [
      {
        id: "connecting_gate",
        icon: "🚶‍♂️🔄✈️",
        label: "Your connecting gate",
        phrases: { en: "Your connecting flight is at gate:", zh: "您的转机航班在登机口：", "zh-Hant": "您的轉機航班在登機口：", ja: "お乗り継ぎ便のゲートは：", ko: "환승 항공편 게이트:", th: "เที่ยวบินต่อเนื่องของคุณอยู่ที่ประตู:", vi: "Chuyến bay nối chuyến của quý khách ở cổng:", hi: "आपकी कनेक्टिंग फ्लाइट गेट पर है:", ar: "رحلتك التالية عند البوابة:", fr: "Votre correspondance est à la porte :", de: "Ihr Anschlussflug ist am Gate:", es: "Su vuelo de conexión está en la puerta:" },
      },
      {
        id: "immigration",
        icon: "🛂",
        label: "Immigration is this way",
        phrases: { en: "Immigration and customs are straight ahead after you exit.", zh: "出机后直走是出入境和海关。", "zh-Hant": "出機後直走是出入境和海關。", ja: "入国審査と税関は出口の先です。", ko: "출입국 심사와 세관은 출구 앞쪽에 있습니다.", th: "ด่านตรวจคนเข้าเมืองอยู่ตรงไปหลังออกจากเครื่อง", vi: "Cửa nhập cảnh và hải quan ở phía trước sau khi ra.", hi: "इमिग्रेशन और कस्टम्स बाहर निकलने के बाद सीधे आगे हैं।", ar: "الهجرة والجمارك مباشرة أمامك بعد الخروج.", fr: "L'immigration et les douanes sont droit devant après la sortie.", de: "Passkontrolle und Zoll sind geradeaus nach dem Ausgang.", es: "Inmigración y aduanas están justo adelante al salir." },
      },
      {
        id: "baggage",
        icon: "🧳🔽",
        label: "Baggage claim",
        phrases: { en: "Baggage claim is on the lower level.", zh: "行李提取在下层。", "zh-Hant": "行李提取在下層。", ja: "手荷物受取所は下の階です。", ko: "수하물 수취대는 아래층에 있습니다.", th: "จุดรับกระเป๋าอยู่ชั้นล่าง", vi: "Khu lấy hành lý ở tầng dưới.", hi: "बैगेज क्लेम निचली मंजिल पर है।", ar: "استلام الأمتعة في الطابق السفلي.", fr: "La récupération des bagages est au niveau inférieur.", de: "Die Gepäckausgabe befindet sich auf der unteren Ebene.", es: "La recogida de equipaje está en el nivel inferior." },
      },
      {
        id: "seat_number",
        icon: "💺🔢",
        label: "Your seat is this way",
        phrases: { en: "Your seat is further down the aisle, on the left / right.", zh: "您的座位在走道前方，左边/右边。", "zh-Hant": "您的座位在走道前方，左邊/右邊。", ja: "お席はこの通路の先、左側/右側です。", ko: "좌석은 통로를 더 가시면 왼쪽/오른쪽에 있습니다.", th: "ที่นั่งของคุณอยู่ถัดไป ด้านซ้าย/ขวา", vi: "Ghế của quý khách ở phía trước, bên trái/phải.", hi: "आपकी सीट गलियारे में आगे है, बाईं/दाईं ओर।", ar: "مقعدك أبعد في الممر، على اليسار / اليمين.", fr: "Votre siège est plus loin dans l'allée, à gauche / droite.", de: "Ihr Sitz ist weiter vorne im Gang, links / rechts.", es: "Su asiento está más adelante, a la izquierda / derecha." },
      },
    ],
  },
  {
    id: "customs",
    label: "Customs & Forms",
    icon: "📋",
    color: "#45aaf2",
    cards: [
      {
        id: "arrival_card",
        icon: "📝✈️",
        label: "Please fill in the arrival card",
        phrases: { en: "Please fill in this arrival card before landing.", zh: "请在降落前填写入境卡。", "zh-Hant": "請在降落前填寫入境卡。", ja: "着陸前にこの入国カードにご記入ください。", ko: "착륙 전에 입국 카드를 작성해 주세요.", th: "กรุณากรอกบัตรขาเข้าก่อนลงจอด", vi: "Vui lòng điền thẻ nhập cảnh trước khi hạ cánh.", hi: "कृपया लैंडिंग से पहले यह आगमन कार्ड भरें।", ar: "يرجى ملء بطاقة الوصول قبل الهبوط.", fr: "Veuillez remplir cette carte d'arrivée avant l'atterrissage.", de: "Bitte füllen Sie die Einreisekarte vor der Landung aus.", es: "Por favor, complete la tarjeta de llegada antes del aterrizaje." },
      },
      {
        id: "passport_please",
        icon: "🛂📕",
        label: "May I see your passport?",
        phrases: { en: "May I see your passport, please?", zh: "请出示您的护照。", "zh-Hant": "請出示您的護照。", ja: "パスポートを拝見してもよろしいですか？", ko: "여권을 보여주시겠어요?", th: "ขอดูพาสปอร์ตของคุณได้ไหม?", vi: "Cho tôi xem hộ chiếu của bạn được không?", hi: "क्या मैं आपका पासपोर्ट देख सकता हूँ?", ar: "هل يمكنني رؤية جواز سفرك؟", fr: "Puis-je voir votre passeport ?", de: "Darf ich Ihren Reisepass sehen?", es: "¿Puedo ver su pasaporte?" },
      },
      {
        id: "boarding_pass",
        icon: "🎫",
        label: "May I see your boarding pass?",
        phrases: { en: "May I see your boarding pass?", zh: "请出示您的登机牌。", "zh-Hant": "請出示您的登機證。", ja: "搭乗券を拝見できますか？", ko: "탑승권을 보여주시겠어요?", th: "ขอดูบัตรขึ้นเครื่องของคุณได้ไหม?", vi: "Cho tôi xem thẻ lên máy bay của bạn được không?", hi: "क्या मैं आपका बोर्डिंग पास देख सकता हूँ?", ar: "هل يمكنني رؤية بطاقة الصعود؟", fr: "Puis-je voir votre carte d'embarquement ?", de: "Darf ich Ihre Bordkarte sehen?", es: "¿Puedo ver su tarjeta de embarque?" },
      },
      {
        id: "declare",
        icon: "🚫📦",
        label: "Do you have anything to declare?",
        phrases: { en: "Do you have anything to declare at customs?", zh: "您有需要报关的物品吗？", "zh-Hant": "您有需要報關的物品嗎？", ja: "税関で申告するものはありますか？", ko: "세관에 신고할 물품이 있으신가요?", th: "คุณมีอะไรต้องสำแดงที่ศุลกากรไหม?", vi: "Quý khách có gì cần khai báo hải quan không?", hi: "क्या आपके पास कस्टम्स में घोषित करने के लिए कुछ है?", ar: "هل لديك ما تصرح به في الجمارك؟", fr: "Avez-vous quelque chose à déclarer aux douanes ?", de: "Haben Sie etwas beim Zoll zu deklarieren?", es: "¿Tiene algo que declarar en aduanas?" },
      },
    ],
  },
];

// ---------- Component ----------

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_SIZE = (SCREEN_WIDTH - 64 - 12) / 2; // 2 columns with padding + gap

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  passengerLang?: string; // Target language code, defaults to showing all
  speechRate: number;
}

function VisualCardsModal({
  visible,
  onClose,
  colors,
  passengerLang,
  speechRate,
}: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>(CARD_CATEGORIES[0].id);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const currentCategory = useMemo(
    () => CARD_CATEGORIES.find((c) => c.id === selectedCategory) ?? CARD_CATEGORIES[0],
    [selectedCategory]
  );

  const speakCard = useCallback(
    (card: VisualCard) => {
      Speech.stop();
      const lang = passengerLang ?? "en";
      // Try exact match, then base language, then English
      const text =
        card.phrases[lang] ??
        card.phrases[lang.split("-")[0]] ??
        card.phrases["en"] ??
        card.label;

      impactLight();
      setIsSpeaking(true);
      Speech.speak(text, {
        language: lang,
        rate: speechRate * 0.9, // Slightly slower for clarity
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    },
    [passengerLang, speechRate]
  );

  const tapCard = useCallback(
    (card: VisualCard) => {
      impactLight();
      if (expandedCard === card.id) {
        // Second tap — speak it
        speakCard(card);
      } else {
        // First tap — expand to show translated text
        setExpandedCard(card.id);
      }
    },
    [expandedCard, speakCard]
  );

  const getTranslatedText = useCallback(
    (card: VisualCard): string | null => {
      if (!passengerLang) return null;
      return (
        card.phrases[passengerLang] ??
        card.phrases[passengerLang.split("-")[0]] ??
        null
      );
    },
    [passengerLang]
  );

  const renderCard = useCallback(
    ({ item: card }: { item: VisualCard }) => {
      const isExpanded = expandedCard === card.id;
      const translatedText = getTranslatedText(card);

      return (
        <TouchableOpacity
          style={[
            styles.card,
            {
              backgroundColor: colors.cardBg,
              borderColor: isExpanded ? currentCategory.color : colors.border,
              borderWidth: isExpanded ? 2 : 1,
              width: isExpanded ? SCREEN_WIDTH - 48 : CARD_SIZE,
              height: isExpanded ? undefined : CARD_SIZE,
            },
          ]}
          onPress={() => tapCard(card)}
          onLongPress={() => speakCard(card)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={card.label}
          accessibilityHint={isExpanded ? "Tap again to speak aloud. Long press to speak." : "Tap to expand and show translation. Long press to speak."}
          accessibilityState={{ expanded: isExpanded }}
        >
          <Text style={styles.cardIcon} importantForAccessibility="no">{card.icon}</Text>
          <Text
            style={[styles.cardLabel, { color: colors.primaryText }]}
            numberOfLines={isExpanded ? undefined : 2}
          >
            {card.label}
          </Text>

          {/* Show translated text when expanded */}
          {isExpanded && translatedText && (
            <View style={[styles.translatedSection, { borderTopColor: colors.borderLight }]}>
              <Text style={[styles.translatedLabel, { color: currentCategory.color }]}>
                {translatedText}
              </Text>
            </View>
          )}

          {isExpanded && (
            <TouchableOpacity
              style={[styles.speakBadge, { backgroundColor: currentCategory.color }]}
              onPress={() => speakCard(card)}
              accessibilityRole="button"
              accessibilityLabel={isSpeaking ? "Stop speaking" : `Speak ${card.label}`}
              accessibilityHint={isSpeaking ? "Stops text-to-speech playback" : "Reads the translated phrase aloud"}
            >
              <Text style={styles.speakBadgeText}>
                {isSpeaking ? "⏹ Stop" : "🔊 Speak"}
              </Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    },
    [expandedCard, currentCategory, colors, tapCard, speakCard, getTranslatedText, isSpeaking]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View accessibilityViewIsModal={true} style={[styles.overlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.content, { backgroundColor: colors.modalBg }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.titleText }]}>Visual Cards</Text>
            <Text style={[styles.subtitle, { color: colors.dimText }]}>
              Tap a card to expand, tap again to speak
            </Text>
          </View>

          {/* Category tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroll}
            contentContainerStyle={styles.categoryContent}
            accessibilityRole="tablist"
            accessibilityLabel="Card categories"
          >
            {CARD_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  { borderColor: colors.border },
                  selectedCategory === cat.id && {
                    backgroundColor: cat.color,
                    borderColor: cat.color,
                  },
                ]}
                onPress={() => {
                  setSelectedCategory(cat.id);
                  setExpandedCard(null);
                  impactLight();
                }}
                accessibilityRole="tab"
                accessibilityLabel={`${cat.label} cards`}
                accessibilityHint={`Shows ${cat.cards.length} ${cat.label.toLowerCase()} communication cards`}
                accessibilityState={{ selected: selectedCategory === cat.id }}
              >
                <Text style={styles.categoryIcon} importantForAccessibility="no">{cat.icon}</Text>
                <Text
                  style={[
                    styles.categoryLabel,
                    { color: colors.primaryText },
                    selectedCategory === cat.id && { color: "#FFFFFF" },
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Cards grid */}
          <FlatList
            data={currentCategory.cards}
            renderItem={renderCard}
            keyExtractor={(item) => item.id}
            numColumns={expandedCard ? 1 : 2}
            columnWrapperStyle={expandedCard ? undefined : styles.cardRow}
            contentContainerStyle={styles.cardGrid}
            showsVerticalScrollIndicator={false}
            key={expandedCard ? `expanded-${expandedCard}` : "grid"}
          />

          {/* Close */}
          <TouchableOpacity
            style={[styles.closeButton, { borderTopColor: colors.borderLight }]}
            onPress={() => {
              Speech.stop();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close visual cards"
            accessibilityHint="Stops any speech and closes the visual cards modal"
          >
            <Text style={[styles.closeText, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    paddingTop: 20,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },

  // Category tabs
  categoryScroll: {
    maxHeight: 48,
    marginBottom: 12,
  },
  categoryContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  categoryIcon: {
    fontSize: 16,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: "600",
  },

  // Card grid
  cardGrid: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  cardRow: {
    gap: 12,
    marginBottom: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  cardIcon: {
    fontSize: 36,
    textAlign: "center",
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },

  // Expanded card
  translatedSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
    width: "100%",
  },
  translatedLabel: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 28,
  },
  speakBadge: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  speakBadgeText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  // Close
  closeButton: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
  },
  closeText: {
    fontSize: 17,
    fontWeight: "600",
  },
});

export default React.memo(VisualCardsModal);
