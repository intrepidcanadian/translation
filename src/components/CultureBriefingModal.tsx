// CultureBriefingModal — Route-aware passenger intelligence for cabin crew
// Gives crew instant cultural context: dietary norms, service expectations,
// common requests, taboos to avoid, and tips for each passenger group.
// Organized by route/region, matching FlightPrep's route presets.

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  FlatList,
  Platform,
} from "react-native";
import { impactLight } from "../services/haptics";
import { primaryAlpha, type ThemeColors } from "../theme";

// ---------- Culture Data ----------

interface CultureTip {
  icon: string;
  text: string;
}

interface DietaryInfo {
  icon: string;
  label: string;
  detail: string;
}

interface CommonPhrase {
  situation: string;
  phrase: string;       // In the passenger's language
  pronunciation: string; // Romanized for crew to read aloud
  english: string;
}

interface PassengerProfile {
  id: string;
  groupName: string;
  flag: string;
  subtitle: string;
  dietary: DietaryInfo[];
  serviceExpectations: CultureTip[];
  commonRequests: string[];
  taboos: CultureTip[];
  crewTips: CultureTip[];
  usefulPhrases: CommonPhrase[];
}

interface RouteGroup {
  id: string;
  label: string;
  icon: string;
  profiles: string[]; // profile IDs
}

// ---------- Route Groups ----------

const ROUTE_GROUPS: RouteGroup[] = [
  { id: "hk_china", label: "HK / China", icon: "🇭🇰", profiles: ["hong_kong", "mainland_china"] },
  { id: "taiwan", label: "Taiwan", icon: "🇹🇼", profiles: ["taiwan"] },
  { id: "japan_korea", label: "Japan / Korea", icon: "🇯🇵", profiles: ["japan", "korea"] },
  { id: "southeast_asia", label: "SE Asia", icon: "🌏", profiles: ["thailand", "vietnam", "indonesia"] },
  { id: "south_asia", label: "South Asia / ME", icon: "🇮🇳", profiles: ["india", "middle_east"] },
  { id: "europe", label: "Europe", icon: "🇪🇺", profiles: ["western_europe"] },
];

// ---------- Passenger Profiles ----------

const PROFILES: Record<string, PassengerProfile> = {
  mainland_china: {
    id: "mainland_china",
    groupName: "Mainland China",
    flag: "🇨🇳",
    subtitle: "Mandarin-speaking passengers from PRC",
    dietary: [
      { icon: "🍜", label: "Hot food & soup preferred", detail: "Many passengers prefer hot meals, soups, and noodles. Instant noodle cups are very popular — offer hot water proactively." },
      { icon: "🥤", label: "Hot water over cold", detail: "Strong cultural preference for hot/warm water (开水 kāi shuǐ). Offering cold water without asking may disappoint. Always have hot water available." },
      { icon: "🍚", label: "Rice with meals", detail: "Rice is expected with most meals. If only bread/pasta is available, mention it when taking orders." },
      { icon: "🚫🧀", label: "Low dairy tolerance", detail: "Many are lactose intolerant. Avoid assuming dairy-heavy meals are suitable. Offer alternatives proactively." },
      { icon: "🍵", label: "Tea culture", detail: "Chinese tea (especially green tea, oolong) preferred over coffee. Offer tea service with meals." },
    ],
    serviceExpectations: [
      { icon: "⏱️", text: "Expect quick, attentive service. Waiting without acknowledgment feels disrespectful." },
      { icon: "🛍️", text: "Very interested in duty-free shopping. May ask for product comparisons and recommendations." },
      { icon: "📱", text: "Frequent phone/device users. Charging access and WiFi info are common requests." },
      { icon: "👶", text: "Family groups common. Extra blankets, bassinets, and child meals frequently requested." },
    ],
    commonRequests: [
      "Hot water (开水)",
      "Instant noodles / cup noodles",
      "Extra blankets",
      "Duty-free catalog and pricing",
      "Phone charging help",
      "Window shade requests (may want open during meals)",
    ],
    taboos: [
      { icon: "🔢", text: "Number 4 is unlucky (sounds like 'death' in Chinese). Avoid seat 4, row 4 references if possible." },
      { icon: "🎁", text: "Don't give items in sets of 4. White wrapping suggests mourning." },
      { icon: "🗣️", text: "Avoid discussing sensitive political topics (Taiwan, Tibet, Hong Kong politics)." },
    ],
    crewTips: [
      { icon: "💡", text: "Learn '请 (qǐng)' = please, '谢谢 (xiè xie)' = thank you. Even basic Mandarin is deeply appreciated." },
      { icon: "🔊", text: "Mainland passengers may speak loudly — this is normal, not rude. It's cultural communication style." },
      { icon: "💳", text: "Many use WeChat Pay / Alipay. If duty-free accepts these, mention it proactively." },
      { icon: "📸", text: "May want to take photos with crew or of the plane. This is positive and complimentary." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "您好，欢迎", pronunciation: "nín hǎo, huān yíng", english: "Hello, welcome" },
      { situation: "Offering hot water", phrase: "需要热水吗？", pronunciation: "xū yào rè shuǐ ma?", english: "Would you like hot water?" },
      { situation: "Meal choice", phrase: "鸡肉还是牛肉？", pronunciation: "jī ròu hái shì niú ròu?", english: "Chicken or beef?" },
      { situation: "Thank you", phrase: "谢谢您", pronunciation: "xiè xie nín", english: "Thank you (polite)" },
    ],
  },

  hong_kong: {
    id: "hong_kong",
    groupName: "Hong Kong",
    flag: "🇭🇰",
    subtitle: "Cantonese-speaking passengers from HK/Macau",
    dietary: [
      { icon: "🍵", label: "Tea with meals essential", detail: "HK passengers expect tea service with every meal. Milk tea (奶茶) and Chinese tea both popular." },
      { icon: "🥡", label: "Dim sum / Cantonese flavors", detail: "Familiar with Cantonese cuisine. Soy sauce, oyster sauce, ginger flavors preferred." },
      { icon: "🧊", label: "Both hot and cold drinks", detail: "Unlike Mainland, HK passengers often accept cold drinks. But always offer the choice." },
      { icon: "🍜", label: "Instant noodles welcome", detail: "Like Mainland, cup noodles are a comfort food. Hot water request is common." },
    ],
    serviceExpectations: [
      { icon: "🏃", text: "Expect fast, efficient service. HK culture values speed and no-nonsense professionalism." },
      { icon: "🗣️", text: "May switch between Cantonese, English, and Mandarin. Most are trilingual." },
      { icon: "💎", text: "Strong interest in luxury duty-free (cosmetics, watches, skincare)." },
      { icon: "📱", text: "Very tech-savvy. Expect WiFi, entertainment systems to work flawlessly." },
    ],
    commonRequests: [
      "Hot water for instant noodles",
      "Extra blankets / pillows",
      "Duty-free skincare and cosmetics",
      "Newspapers (SCMP, Oriental Daily)",
      "Specific drink preferences (milk tea, lemon tea)",
    ],
    taboos: [
      { icon: "🕐", text: "Don't give clocks as gifts (送钟 sounds like 'attending a funeral')." },
      { icon: "🗣️", text: "Many HK residents are sensitive about being assumed to be from Mainland China. Address as 'Hong Kong' specifically." },
    ],
    crewTips: [
      { icon: "💡", text: "'唔該 (m̀h gōi)' = thank you/excuse me in Cantonese. Most valuable phrase for HK passengers." },
      { icon: "🌐", text: "HK passengers often speak excellent English. Don't default to Mandarin — ask which language they prefer." },
      { icon: "🛒", text: "Cosmetics, skincare (SK-II, Shiseido, La Mer) are top duty-free sellers for HK passengers." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "你好，歡迎", pronunciation: "néih hóu, fūn yìhng", english: "Hello, welcome" },
      { situation: "What drink?", phrase: "想飲咩？", pronunciation: "séung yám mē?", english: "What would you like to drink?" },
      { situation: "Thank you", phrase: "唔該晒", pronunciation: "m̀h gōi saai", english: "Thank you very much" },
    ],
  },

  taiwan: {
    id: "taiwan",
    groupName: "Taiwan",
    flag: "🇹🇼",
    subtitle: "Mandarin-speaking passengers from Taiwan",
    dietary: [
      { icon: "🥬", label: "Vegetarian/Buddhist options", detail: "Taiwan has one of the world's highest rates of vegetarianism. Always offer vegetarian meals. Many follow Buddhist dietary rules (no garlic, onion, leeks)." },
      { icon: "🧋", label: "Bubble tea culture", detail: "Strong tea culture. Milk tea, bubble tea references resonate. Sweet drinks are popular." },
      { icon: "🌶️", label: "Mild to medium spice", detail: "Generally prefer less spicy food compared to Sichuan-style. Japanese-influenced cuisine is familiar." },
      { icon: "🍚", label: "Rice-based meals preferred", detail: "Like Mainland, rice is the expected staple with meals." },
    ],
    serviceExpectations: [
      { icon: "😊", text: "Generally very polite and patient. Appreciate warm, friendly service over just efficiency." },
      { icon: "🤝", text: "Value politeness highly. 'Thank you' and 'please' equivalent should be used liberally." },
      { icon: "🛍️", text: "Interested in Japanese and Korean beauty products in duty-free." },
    ],
    commonRequests: [
      "Vegetarian meal options",
      "Hot water or hot tea",
      "Japanese/Korean beauty products (duty-free)",
      "USB charging",
      "Blankets (often feel cold on flights)",
    ],
    taboos: [
      { icon: "🏷️", text: "Do NOT refer to Taiwan as part of China or use 'Chinese Taipei.' Use 'Taiwan' as the destination/origin." },
      { icon: "🔢", text: "Number 4 is unlucky (same as Mainland). Number 8 is lucky." },
    ],
    crewTips: [
      { icon: "💡", text: "Taiwanese Mandarin sounds softer than Mainland Mandarin. They use Traditional Chinese characters (繁體)." },
      { icon: "🙏", text: "Many are Buddhist or follow folk religion. Vegetarian options are genuinely needed, not a preference." },
      { icon: "🇯🇵", text: "Strong affinity for Japanese culture. Japanese product recommendations in duty-free are well-received." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "您好，歡迎搭乘", pronunciation: "nín hǎo, huān yíng dā chéng", english: "Hello, welcome aboard" },
      { situation: "Vegetarian?", phrase: "需要素食餐嗎？", pronunciation: "xū yào sù shí cān ma?", english: "Do you need a vegetarian meal?" },
      { situation: "Thank you", phrase: "感謝您", pronunciation: "gǎn xiè nín", english: "Thank you (formal)" },
    ],
  },

  japan: {
    id: "japan",
    groupName: "Japan",
    flag: "🇯🇵",
    subtitle: "Japanese-speaking passengers",
    dietary: [
      { icon: "🍱", label: "Presentation matters", detail: "Japanese passengers notice food presentation. Neat, organized meals make a strong positive impression." },
      { icon: "🐟", label: "Seafood familiar", detail: "Raw fish, seafood, and sushi are normal. But also appreciate Western meals when traveling." },
      { icon: "🍵", label: "Green tea expected", detail: "Japanese green tea (お茶 ocha) is a strong expectation. Offer tea, not just coffee." },
      { icon: "🍶", label: "Sake / Japanese beer", detail: "Japanese beer (Asahi, Sapporo, Kirin) and sake highly appreciated if available in-flight." },
      { icon: "🚫", label: "Strong flavors cautious", detail: "May avoid very spicy, heavily seasoned, or cheese-heavy foods." },
    ],
    serviceExpectations: [
      { icon: "🤫", text: "Value quiet, discreet service. Speaking softly is respectful. Avoid being boisterous around Japanese passengers." },
      { icon: "🙇", text: "A slight bow when greeting or serving is deeply appreciated and shows cultural awareness." },
      { icon: "📋", text: "Will rarely complain, even when unhappy. Proactively check on them — silence doesn't mean satisfaction." },
      { icon: "🧹", text: "Extremely tidy. Will organize their space neatly. Appreciate clean, well-maintained cabins." },
    ],
    commonRequests: [
      "Green tea (お茶)",
      "Hot towel / oshibori",
      "Blankets and eye masks",
      "Japanese newspapers (if available)",
      "Quiet / minimal disturbance during rest",
    ],
    taboos: [
      { icon: "🍜", text: "Don't stick chopsticks upright in food — this is a funeral ritual." },
      { icon: "💴", text: "Number 4 (shi = death) and 9 (ku = suffering) are unlucky." },
      { icon: "👃", text: "Blowing nose loudly in public is very rude. Offer tissues discreetly." },
      { icon: "🤝", text: "Physical contact (hugs, shoulder pats) is uncomfortable. Bow instead of handshake." },
    ],
    crewTips: [
      { icon: "💡", text: "'すみません (sumimasen)' = excuse me/sorry, the single most useful Japanese word for service situations." },
      { icon: "🎌", text: "Japanese passengers who don't speak English may be too polite to ask for help. Check on them proactively." },
      { icon: "🛍️", text: "Japanese cosmetics (Shiseido, SK-II) and electronics are popular duty-free for return flights." },
      { icon: "⏰", text: "Extremely punctual. Any delay should be communicated immediately with an apology." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "いらっしゃいませ", pronunciation: "irasshaimase", english: "Welcome (aboard)" },
      { situation: "Meal choice", phrase: "チキンとビーフ、どちらがよろしいですか？", pronunciation: "chikin to biifu, dochira ga yoroshii desu ka?", english: "Chicken or beef, which would you prefer?" },
      { situation: "Tea offer", phrase: "お茶はいかがですか？", pronunciation: "ocha wa ikaga desu ka?", english: "Would you like tea?" },
      { situation: "Thank you", phrase: "ありがとうございます", pronunciation: "arigatou gozaimasu", english: "Thank you very much" },
    ],
  },

  korea: {
    id: "korea",
    groupName: "South Korea",
    flag: "🇰🇷",
    subtitle: "Korean-speaking passengers",
    dietary: [
      { icon: "🌶️", label: "Spicy food welcome", detail: "Koreans generally enjoy and expect spicy options. Gochujang, kimchi flavors are comfort food." },
      { icon: "🍜", label: "Ramyeon / instant noodles", detail: "Korean instant noodles (ramyeon) are extremely popular. Hot water is frequently requested." },
      { icon: "🥬", label: "Side dishes expected", detail: "Korean meals traditionally include banchan (side dishes). A single-item meal may feel incomplete." },
      { icon: "🍺", label: "Soju and beer culture", detail: "Soju is Korea's national drink. Korean beer (Cass, Hite) and soju-beer mixes (somaek) are popular." },
    ],
    serviceExpectations: [
      { icon: "👴", text: "Age hierarchy is important. Serve elderly passengers first. Use both hands when offering items to elders." },
      { icon: "🗣️", text: "Direct communication style. May make requests assertively — this is normal, not rude." },
      { icon: "📱", text: "Very tech-oriented. K-drama/K-pop content on entertainment systems is appreciated." },
      { icon: "🛍️", text: "Huge duty-free market. Korean passengers are the world's biggest duty-free shoppers." },
    ],
    commonRequests: [
      "Hot water for ramyeon",
      "Spicy food options",
      "Soju or Korean beer (if available)",
      "Duty-free cosmetics (Korean and luxury brands)",
      "USB charging access",
      "Extra blankets",
    ],
    taboos: [
      { icon: "🤚", text: "Don't pour your own drink — this is seen as lacking manners. Crew pouring is always appreciated." },
      { icon: "✍️", text: "Don't write someone's name in red ink — associated with death." },
      { icon: "🎁", text: "Avoid giving/receiving with one hand. Use both hands for respectful exchanges." },
    ],
    crewTips: [
      { icon: "💡", text: "'감사합니다 (gamsahamnida)' = thank you. Most important Korean phrase for crew." },
      { icon: "🧴", text: "K-beauty products are the #1 duty-free purchase. Know your Korean skincare brands (Innisfree, Laneige, Sulwhasoo)." },
      { icon: "🍜", text: "Having Korean ramyeon available (Shin Ramyun) creates an outsized positive reaction." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "안녕하세요, 환영합니다", pronunciation: "annyeonghaseyo, hwanyeonghamnida", english: "Hello, welcome" },
      { situation: "Meal choice", phrase: "닭고기와 소고기 중 어떤 것을 드릴까요?", pronunciation: "dalgogi-wa sogogi jung eotteon geoseul deurilkkayo?", english: "Would you like chicken or beef?" },
      { situation: "Thank you", phrase: "감사합니다", pronunciation: "gamsahamnida", english: "Thank you" },
    ],
  },

  thailand: {
    id: "thailand",
    groupName: "Thailand",
    flag: "🇹🇭",
    subtitle: "Thai-speaking passengers",
    dietary: [
      { icon: "🌶️", label: "Spicy food is default", detail: "Thai passengers generally expect spice. 'Not spicy' options should be explicitly offered." },
      { icon: "🍚", label: "Rice with everything", detail: "Jasmine rice is the expected base for any meal. Meals without rice may feel incomplete." },
      { icon: "🐟", label: "Fish sauce is comfort", detail: "Fish sauce (nam pla) is a staple flavor. Thai passengers find Western food bland without familiar condiments." },
      { icon: "🥭", label: "Fresh fruit appreciated", detail: "Fresh tropical fruit is highly valued. Fruit as dessert is preferred over heavy Western desserts." },
    ],
    serviceExpectations: [
      { icon: "🙏", text: "The 'wai' (hands pressed together in greeting) is deeply respectful. A slight wai when greeting Thai passengers makes an enormous impression." },
      { icon: "😊", text: "Thailand is the 'Land of Smiles.' Warm, smiling service is the cultural expectation." },
      { icon: "👑", text: "Deep reverence for the Thai Royal Family. Never make casual remarks about Thai royalty." },
    ],
    commonRequests: [
      "Hot water or warm water",
      "Rice with meals",
      "Spicy condiments if available",
      "Blankets (Thai passengers often feel cold on flights)",
      "Duty-free perfume and cosmetics",
    ],
    taboos: [
      { icon: "🦶", text: "Feet are considered the lowest part of the body. Never point feet at anyone or step over someone." },
      { icon: "👤", text: "The head is sacred. Never touch a Thai person's head, even a child's." },
      { icon: "👑", text: "Never disrespect the Thai Royal Family in any way. This is both a cultural and legal matter." },
    ],
    crewTips: [
      { icon: "💡", text: "'ขอบคุณครับ/ค่ะ (khob khun khrap/kha)' = thank you. Add ครับ (khrap) if male, ค่ะ (kha) if female." },
      { icon: "🙏", text: "A small wai gesture (palms together at chest) when serving goes a very long way." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "สวัสดีครับ/ค่ะ", pronunciation: "sawatdee khrap/kha", english: "Hello" },
      { situation: "Thank you", phrase: "ขอบคุณครับ/ค่ะ", pronunciation: "khob khun khrap/kha", english: "Thank you" },
      { situation: "Are you OK?", phrase: "สบายดีไหม?", pronunciation: "sabai dee mai?", english: "Are you comfortable?" },
    ],
  },

  vietnam: {
    id: "vietnam",
    groupName: "Vietnam",
    flag: "🇻🇳",
    subtitle: "Vietnamese-speaking passengers",
    dietary: [
      { icon: "🍜", label: "Pho and noodle soup", detail: "Soup-based dishes and noodles are comfort food. Hot meals strongly preferred over cold options." },
      { icon: "🌿", label: "Fresh herbs expected", detail: "Vietnamese cuisine uses fresh herbs extensively. The absence of fresh flavors makes meals feel plain." },
      { icon: "☕", label: "Vietnamese coffee", detail: "Strong, sweet condensed milk coffee (cà phê sữa đá) is a cultural staple. Strong coffee is appreciated." },
      { icon: "🍚", label: "Rice is essential", detail: "Like Thailand, rice is the expected base for meals." },
    ],
    serviceExpectations: [
      { icon: "👴", text: "Respect for elders is paramount. Serve older passengers first and with extra attentiveness." },
      { icon: "🤝", text: "Generally warm and appreciative of attentive service. Small gestures are deeply valued." },
    ],
    commonRequests: [
      "Hot water",
      "Strong coffee",
      "Rice with meals",
      "Extra blankets",
      "Duty-free electronics and cosmetics",
    ],
    taboos: [
      { icon: "👤", text: "Like Thailand, don't touch the head. It's considered disrespectful." },
      { icon: "🤞", text: "Crossed fingers gesture is vulgar in Vietnam. Avoid it." },
    ],
    crewTips: [
      { icon: "💡", text: "'Cảm ơn (kahm uhn)' = thank you. Simple but appreciated." },
      { icon: "🇻🇳", text: "Vietnamese passengers may be less assertive in requesting things. Offer choices proactively." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "Xin chào", pronunciation: "sin chow", english: "Hello" },
      { situation: "Thank you", phrase: "Cảm ơn", pronunciation: "kahm uhn", english: "Thank you" },
    ],
  },

  indonesia: {
    id: "indonesia",
    groupName: "Indonesia",
    flag: "🇮🇩",
    subtitle: "Indonesian/Malay-speaking passengers",
    dietary: [
      { icon: "☪️", label: "Halal is essential", detail: "Indonesia is the world's largest Muslim country. ~87% Muslim. ALWAYS have halal options available and clearly labeled." },
      { icon: "🚫🐷", label: "No pork, no alcohol", detail: "Pork and alcohol must never be served to Muslim passengers without explicit request. Even cross-contamination concerns matter." },
      { icon: "🌶️", label: "Spicy food preferred", detail: "Sambal (chili paste) is a staple. Indonesian food is generally well-seasoned and spicy." },
      { icon: "🍚", label: "Rice-based meals", detail: "Nasi (rice) is the foundation of every meal." },
    ],
    serviceExpectations: [
      { icon: "🕌", text: "During Ramadan (check dates), Muslim passengers fast sunrise to sunset. Be aware of prayer times and fasting schedules." },
      { icon: "🤲", text: "Right hand for giving and receiving. The left hand is considered unclean." },
      { icon: "😊", text: "Generally very friendly and patient. Appreciate warm, personal service." },
    ],
    commonRequests: [
      "Halal meal confirmation",
      "Prayer time information",
      "Direction to Mecca (for prayer on long flights)",
      "Hot water or tea",
      "Non-alcoholic beverages",
    ],
    taboos: [
      { icon: "🤚", text: "Left hand is considered unclean. Always offer items with the right hand." },
      { icon: "👤", text: "Don't touch the head. Same cultural sensitivity as Thailand/Vietnam." },
      { icon: "🐷", text: "Never assume a Muslim passenger wants pork or alcohol. Always ask." },
    ],
    crewTips: [
      { icon: "💡", text: "'Terima kasih (te-ree-ma ka-see)' = thank you in Bahasa Indonesia." },
      { icon: "☪️", text: "If unsure about halal status of food, be honest. Passengers would rather skip a meal than eat non-halal food." },
      { icon: "📅", text: "Be aware of Ramadan dates each year. Fasting passengers may need special meal timing." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "Selamat datang", pronunciation: "se-la-mat da-tang", english: "Welcome" },
      { situation: "Halal?", phrase: "Ini halal", pronunciation: "ee-nee ha-lal", english: "This is halal" },
      { situation: "Thank you", phrase: "Terima kasih", pronunciation: "te-ree-ma ka-see", english: "Thank you" },
    ],
  },

  india: {
    id: "india",
    groupName: "India",
    flag: "🇮🇳",
    subtitle: "Hindi/English-speaking passengers from India",
    dietary: [
      { icon: "🥬", label: "Vegetarian is very common", detail: "~40% of Indians are vegetarian. ALWAYS offer veg options. 'Pure veg' means no eggs either." },
      { icon: "🐄", label: "No beef for Hindus", detail: "Cows are sacred in Hinduism. Never assume a Hindu passenger will eat beef. Ask explicitly." },
      { icon: "☪️", label: "Halal for Muslim Indians", detail: "~15% of India is Muslim. Halal requirements apply. Some Indian passengers are Jain (no root vegetables, strict veg)." },
      { icon: "🌶️", label: "Spice tolerance high", detail: "Indian passengers generally find Western food bland. Spicy options are appreciated." },
      { icon: "🍵", label: "Chai tea essential", detail: "Indian chai (with milk, sugar, spices) is a cultural staple. Tea > coffee for most." },
    ],
    serviceExpectations: [
      { icon: "👨‍👩‍👧‍👦", text: "Large family groups common. Children's meals, extra blankets, and bassinet requests are frequent." },
      { icon: "🗣️", text: "Most educated Indians speak English, but may have strong regional accents. Speak clearly, not louder." },
      { icon: "🤲", text: "Namaste (palms together, slight bow) is universally appropriate." },
    ],
    commonRequests: [
      "Vegetarian meal (confirm no meat, possibly no eggs)",
      "Chai tea with milk and sugar",
      "Spicy food options",
      "Extra blankets and pillows",
      "Children's meals and entertainment",
      "Hot water",
    ],
    taboos: [
      { icon: "🐄", text: "Never offer beef to Hindu passengers without asking. It's not just a preference — it's deeply religious." },
      { icon: "🤚", text: "Left hand is considered unclean (same as Indonesia). Use right hand for serving." },
      { icon: "👟", text: "Shoes are impure. If a passenger removes shoes, don't draw attention to it." },
    ],
    crewTips: [
      { icon: "💡", text: "'Namaste (na-ma-stay)' with palms together is the universal Indian greeting. Always appropriate." },
      { icon: "🥗", text: "When offering meals, always mention the vegetarian option first — it shows cultural awareness." },
      { icon: "🍵", text: "Offering chai tea proactively creates immediate rapport with Indian passengers." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "नमस्ते", pronunciation: "namaste", english: "Hello (respectful)" },
      { situation: "Veg or non-veg?", phrase: "शाकाहारी या मांसाहारी?", pronunciation: "shakahari ya mansahari?", english: "Vegetarian or non-vegetarian?" },
      { situation: "Thank you", phrase: "धन्यवाद", pronunciation: "dhanyavaad", english: "Thank you" },
    ],
  },

  middle_east: {
    id: "middle_east",
    groupName: "Middle East",
    flag: "🇦🇪",
    subtitle: "Arabic-speaking passengers from Gulf states, Levant",
    dietary: [
      { icon: "☪️", label: "Halal is mandatory", detail: "All food must be halal. This is non-negotiable for most passengers. Clearly communicate halal status." },
      { icon: "🚫🐷", label: "Absolutely no pork", detail: "Pork in any form (including gelatin, lard) is prohibited. Check ingredient lists." },
      { icon: "🚫🍺", label: "No alcohol (for many)", detail: "Many Muslim passengers don't drink alcohol. Always have premium non-alcoholic options. Some may accept alcohol — never assume either way." },
      { icon: "📅", label: "Dates and Arabic coffee", detail: "Arabic coffee (qahwa) and dates are deeply cultural. Offering these creates an exceptional impression." },
      { icon: "🍖", label: "Lamb preferred", detail: "Lamb/mutton is the preferred protein across the Middle East. Chicken is also universally acceptable." },
    ],
    serviceExpectations: [
      { icon: "👑", text: "Gulf passengers (UAE, Saudi, Qatar) may expect premium service regardless of cabin class. Attentiveness is key." },
      { icon: "🕌", text: "Prayer times are important. Be aware and accommodating of passengers who need to pray." },
      { icon: "👨‍👧", text: "Gender sensitivity: some passengers prefer interaction with same-gender crew." },
      { icon: "🎁", text: "Hospitality (dhiyafa) is the highest cultural value. Generosity in service is deeply respected." },
    ],
    commonRequests: [
      "Halal meal confirmation",
      "Arabic coffee or tea with dates",
      "Non-alcoholic beverages",
      "Prayer direction (Qibla) for long flights",
      "Premium duty-free (perfume, watches, jewelry)",
      "Extra service attention for elderly family members",
    ],
    taboos: [
      { icon: "🤚", text: "Left hand taboo. Always use right hand for serving." },
      { icon: "👟", text: "Showing the sole of your foot/shoe is very offensive. Be mindful when crossing legs near passengers." },
      { icon: "🍺", text: "Never push alcohol on Middle Eastern passengers. Offer non-alcoholic alternatives first." },
      { icon: "👫", text: "Avoid excessive physical contact, especially between genders. A right-hand-on-heart gesture works universally." },
    ],
    crewTips: [
      { icon: "💡", text: "'السلام عليكم (as-salaam alaykum)' = peace be upon you. The universal Arabic greeting." },
      { icon: "🫖", text: "Arabic coffee is served without sugar, in small cups. Offering dates alongside is the cultural norm." },
      { icon: "🕌", text: "During Ramadan, be prepared: fasting passengers need meals at specific times (before dawn, after sunset)." },
      { icon: "💎", text: "Gulf passengers are among the world's highest spenders on duty-free luxury goods (perfume, watches)." },
    ],
    usefulPhrases: [
      { situation: "Greeting", phrase: "السلام عليكم", pronunciation: "as-salaam alaykum", english: "Peace be upon you" },
      { situation: "Welcome", phrase: "أهلاً وسهلاً", pronunciation: "ahlan wa sahlan", english: "Welcome" },
      { situation: "Thank you", phrase: "شكراً", pronunciation: "shukran", english: "Thank you" },
      { situation: "This is halal", phrase: "هذا حلال", pronunciation: "hatha halal", english: "This is halal" },
    ],
  },

  western_europe: {
    id: "western_europe",
    groupName: "Western Europe",
    flag: "🇪🇺",
    subtitle: "French, German, Spanish, Italian passengers",
    dietary: [
      { icon: "🍷", label: "Wine with meals", detail: "European passengers often expect wine options with dinner. Quality matters — don't just offer 'red or white.'" },
      { icon: "🧀", label: "Cheese and bread", detail: "Bread and cheese are standard parts of European meals. A cheese course is appreciated." },
      { icon: "☕", label: "Espresso culture", detail: "Good coffee is expected, especially for Italian and French passengers. Weak coffee is noticed." },
      { icon: "🥗", label: "Health-conscious options", detail: "Northern Europeans often appreciate lighter, healthier options. Salads, whole grains, fish." },
    ],
    serviceExpectations: [
      { icon: "🤵", text: "Formal politeness expected, especially by French and German passengers. 'Sir/Madam' equivalent matters." },
      { icon: "🕐", text: "German and Swiss passengers value punctuality and order. Delays should be communicated precisely." },
      { icon: "🍽️", text: "French and Italian passengers care deeply about food quality. Meal service is a highlight, not an afterthought." },
      { icon: "🤫", text: "Personal space is valued. Don't be overly chatty unless the passenger initiates." },
    ],
    commonRequests: [
      "Wine selection details",
      "Espresso or quality coffee",
      "Specific dietary preferences (gluten-free, lactose-free common)",
      "Newspapers in home language",
      "Duty-free spirits and fragrances",
    ],
    taboos: [
      { icon: "🗣️", text: "Don't assume all Europeans speak English. Attempt a greeting in their language first." },
      { icon: "🇫🇷", text: "French passengers especially appreciate any attempt at French, even just 'Bonjour' and 'Merci.'" },
      { icon: "🤏", text: "OK gesture (thumb+index circle) is rude in some European countries. Use thumbs up instead." },
    ],
    crewTips: [
      { icon: "🇫🇷", text: "'Bonjour' (French), 'Guten Tag' (German), 'Buongiorno' (Italian), 'Hola' (Spanish) — learn 4 greetings, cover a continent." },
      { icon: "🍷", text: "Being able to describe the wine being served (grape, region) makes a disproportionate impression." },
      { icon: "🧳", text: "European travelers are often experienced. They value professionalism over effusiveness." },
    ],
    usefulPhrases: [
      { situation: "French greeting", phrase: "Bonjour, bienvenue", pronunciation: "bon-ZHOOR, bee-en-vuh-NOO", english: "Hello, welcome" },
      { situation: "German greeting", phrase: "Guten Tag, willkommen", pronunciation: "GOO-ten tahg, vil-KOM-men", english: "Good day, welcome" },
      { situation: "Spanish greeting", phrase: "Hola, bienvenido", pronunciation: "OH-la, bee-en-veh-NEE-do", english: "Hello, welcome" },
      { situation: "Italian greeting", phrase: "Buongiorno, benvenuto", pronunciation: "bwon-JHOR-no, ben-veh-NOO-to", english: "Good day, welcome" },
    ],
  },
};

// ---------- Section Tabs ----------

type SectionTab = "dietary" | "service" | "phrases" | "tips";

const SECTION_TABS: Array<{ key: SectionTab; label: string; icon: string }> = [
  { key: "dietary", label: "Dietary", icon: "🍽️" },
  { key: "service", label: "Service", icon: "🤝" },
  { key: "phrases", label: "Phrases", icon: "💬" },
  { key: "tips", label: "Tips", icon: "💡" },
];

// ---------- Sub-components ----------

const InfoCard = React.memo(function InfoCard({
  item,
  colors,
}: {
  item: DietaryInfo;
  colors: ThemeColors;
}) {
  return (
    <View style={[styles.infoCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
      <Text style={styles.infoCardIcon}>{item.icon}</Text>
      <View style={styles.infoCardBody}>
        <Text style={[styles.infoCardTitle, { color: colors.primaryText }]}>{item.label}</Text>
        <Text style={[styles.infoCardDetail, { color: colors.secondaryText }]}>{item.detail}</Text>
      </View>
    </View>
  );
});

const TipRow = React.memo(function TipRow({
  tip,
  colors,
  bgColor,
  borderColor,
}: {
  tip: CultureTip;
  colors: ThemeColors;
  bgColor?: string;
  borderColor?: string;
}) {
  return (
    <View style={[styles.tipRow, { backgroundColor: bgColor ?? colors.cardBg, borderColor: borderColor ?? colors.border }]}>
      <Text style={styles.tipIcon}>{tip.icon}</Text>
      <Text style={[styles.tipText, { color: colors.secondaryText }]}>{tip.text}</Text>
    </View>
  );
});

const PhraseCard = React.memo(function PhraseCard({
  phrase,
  colors,
}: {
  phrase: CommonPhrase;
  colors: ThemeColors;
}) {
  return (
    <View style={[styles.phraseCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
      <Text style={[styles.phraseSituation, { color: colors.mutedText }]}>{phrase.situation}</Text>
      <Text style={[styles.phraseNative, { color: colors.primaryText }]}>{phrase.phrase}</Text>
      <Text style={[styles.phrasePronunciation, { color: colors.primary }]}>🔊 {phrase.pronunciation}</Text>
      <Text style={[styles.phraseEnglish, { color: colors.secondaryText }]}>{phrase.english}</Text>
    </View>
  );
});

const RoutePill = React.memo(function RoutePill({
  group,
  isActive,
  onSelect,
  colors,
}: {
  group: { id: string; label: string; icon: string };
  isActive: boolean;
  onSelect: (routeId: string) => void;
  colors: ThemeColors;
}) {
  const handlePress = useCallback(() => onSelect(group.id), [onSelect, group.id]);
  return (
    <TouchableOpacity
      key={group.id}
      style={[styles.routePill, { backgroundColor: isActive ? colors.primary : colors.cardBg, borderColor: isActive ? colors.primary : colors.border }]}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${group.label} route`}
      accessibilityHint={isActive ? "Currently selected route" : `Switch to ${group.label} passenger profiles`}
    >
      <Text style={styles.routePillIcon} importantForAccessibility="no">{group.icon}</Text>
      <Text style={[styles.routePillLabel, { color: isActive ? "#fff" : colors.mutedText }]}>{group.label}</Text>
    </TouchableOpacity>
  );
});

const ProfilePill = React.memo(function ProfilePill({
  profile,
  isActive,
  onSelect,
  colors,
}: {
  profile: PassengerProfile;
  isActive: boolean;
  onSelect: (profileId: string) => void;
  colors: ThemeColors;
}) {
  const handlePress = useCallback(() => onSelect(profile.id), [onSelect, profile.id]);
  return (
    <TouchableOpacity
      key={profile.id}
      style={[styles.profilePill, { backgroundColor: isActive ? primaryAlpha.faint : "transparent", borderColor: isActive ? colors.primary : colors.borderLight }]}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${profile.groupName} passenger profile`}
      accessibilityHint={isActive ? "Currently selected profile" : `View cultural tips for ${profile.groupName} passengers`}
    >
      <Text style={styles.profilePillFlag} importantForAccessibility="no">{profile.flag}</Text>
      <Text style={[styles.profilePillLabel, { color: isActive ? colors.primary : colors.secondaryText }]}>{profile.groupName}</Text>
    </TouchableOpacity>
  );
});

const SectionTabPill = React.memo(function SectionTabPill({
  tab,
  isActive,
  onSelect,
  colors,
}: {
  tab: { key: SectionTab; label: string; icon: string };
  isActive: boolean;
  onSelect: (key: SectionTab) => void;
  colors: ThemeColors;
}) {
  const handlePress = useCallback(() => { impactLight(); onSelect(tab.key); }, [onSelect, tab.key]);
  return (
    <TouchableOpacity
      key={tab.key}
      style={[styles.sectionTab, isActive && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${tab.label} section`}
      accessibilityHint={isActive ? `Viewing ${tab.label.toLowerCase()} information` : `Switch to ${tab.label.toLowerCase()} information`}
    >
      <Text style={styles.sectionTabIcon} importantForAccessibility="no">{tab.icon}</Text>
      <Text style={[styles.sectionTabLabel, { color: isActive ? colors.primary : colors.mutedText }]}>{tab.label}</Text>
    </TouchableOpacity>
  );
});

// ---------- Component ----------

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  initialRoute?: string; // Pre-select a route group
}

function CultureBriefingModal({ visible, onClose, colors, initialRoute }: Props) {
  const [selectedRoute, setSelectedRoute] = useState<string>(initialRoute ?? ROUTE_GROUPS[0].id);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionTab>("dietary");

  const currentGroup = useMemo(
    () => ROUTE_GROUPS.find((g) => g.id === selectedRoute) ?? ROUTE_GROUPS[0],
    [selectedRoute]
  );

  const profileList = useMemo(
    () => currentGroup.profiles.map((pid) => PROFILES[pid]).filter(Boolean),
    [currentGroup]
  );

  const currentProfile = useMemo(
    () => (selectedProfile ? PROFILES[selectedProfile] : profileList[0]) ?? null,
    [selectedProfile, profileList]
  );

  // Auto-select first profile when route changes
  const handleRouteSelect = useCallback((routeId: string) => {
    impactLight();
    setSelectedRoute(routeId);
    const group = ROUTE_GROUPS.find((g) => g.id === routeId);
    setSelectedProfile(group?.profiles[0] ?? null);
    setActiveSection("dietary");
  }, []);

  const handleProfileSelect = useCallback((profileId: string) => {
    impactLight();
    setSelectedProfile(profileId);
    setActiveSection("dietary");
  }, []);

  const renderDietarySection = useCallback(() => {
    if (!currentProfile) return null;
    return (
      <View style={styles.sectionContent}>
        {currentProfile.dietary.map((item) => (
          <InfoCard key={item.label} item={item} colors={colors} />
        ))}

        <Text style={[styles.subheading, { color: colors.primaryText }]}>Common Requests</Text>
        {currentProfile.commonRequests.map((req) => (
          <View key={req} style={[styles.requestRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.requestBullet, { color: colors.primary }]}>•</Text>
            <Text style={[styles.requestText, { color: colors.secondaryText }]}>{req}</Text>
          </View>
        ))}
      </View>
    );
  }, [currentProfile, colors]);

  const renderServiceSection = useCallback(() => {
    if (!currentProfile) return null;
    return (
      <View style={styles.sectionContent}>
        <Text style={[styles.subheading, { color: colors.primaryText }]}>Service Expectations</Text>
        {currentProfile.serviceExpectations.map((tip) => (
          <TipRow key={tip.text} tip={tip} colors={colors} />
        ))}

        <Text style={[styles.subheading, { color: "#ff4757" }]}>⚠️ Cultural Taboos — Avoid</Text>
        {currentProfile.taboos.map((taboo) => (
          <TipRow key={taboo.text} tip={taboo} colors={colors} bgColor="rgba(255,71,87,0.08)" borderColor="rgba(255,71,87,0.2)" />
        ))}
      </View>
    );
  }, [currentProfile, colors]);

  const renderPhrasesSection = useCallback(() => {
    if (!currentProfile) return null;
    return (
      <View style={styles.sectionContent}>
        <Text style={[styles.subheading, { color: colors.primaryText }]}>Useful Phrases</Text>
        {currentProfile.usefulPhrases.map((phrase) => (
          <PhraseCard key={phrase.phrase} phrase={phrase} colors={colors} />
        ))}
      </View>
    );
  }, [currentProfile, colors]);

  const renderTipsSection = useCallback(() => {
    if (!currentProfile) return null;
    return (
      <View style={styles.sectionContent}>
        <Text style={[styles.subheading, { color: colors.primaryText }]}>Crew Tips</Text>
        {currentProfile.crewTips.map((tip) => (
          <TipRow key={tip.text} tip={tip} colors={colors} />
        ))}
      </View>
    );
  }, [currentProfile, colors]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.containerBg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerClose} accessibilityRole="button" accessibilityLabel="Close culture guide" accessibilityHint="Closes the passenger culture guide modal">
            <Text style={[styles.headerCloseText, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.titleText }]}>Passenger Culture Guide</Text>
          <View style={styles.headerClose} />
        </View>

        {/* Route selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.routeStrip} contentContainerStyle={styles.routeStripContent} accessibilityRole="tablist">
          {ROUTE_GROUPS.map((group) => (
            <RoutePill key={group.id} group={group} isActive={group.id === selectedRoute} onSelect={handleRouteSelect} colors={colors} />
          ))}
        </ScrollView>

        {/* Profile tabs (if route has multiple) */}
        {profileList.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.profileStrip} contentContainerStyle={styles.profileStripContent}>
            {profileList.map((profile) => (
              <ProfilePill key={profile.id} profile={profile} isActive={profile.id === currentProfile?.id} onSelect={handleProfileSelect} colors={colors} />
            ))}
          </ScrollView>
        )}

        {/* Profile header */}
        {currentProfile && (
          <View style={styles.profileHeader}>
            <Text style={styles.profileFlag}>{currentProfile.flag}</Text>
            <View>
              <Text style={[styles.profileName, { color: colors.titleText }]}>{currentProfile.groupName}</Text>
              <Text style={[styles.profileSubtitle, { color: colors.mutedText }]}>{currentProfile.subtitle}</Text>
            </View>
          </View>
        )}

        {/* Section tabs */}
        <View style={[styles.sectionTabs, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
          {SECTION_TABS.map((tab) => (
            <SectionTabPill key={tab.key} tab={tab} isActive={tab.key === activeSection} onSelect={setActiveSection} colors={colors} />
          ))}
        </View>

        {/* Content */}
        <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentInner} showsVerticalScrollIndicator={false}>
          {activeSection === "dietary" && renderDietarySection()}
          {activeSection === "service" && renderServiceSection()}
          {activeSection === "phrases" && renderPhrasesSection()}
          {activeSection === "tips" && renderTipsSection()}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default React.memo(CultureBriefingModal);

// ---------- Styles ----------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 16 : 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerClose: { width: 60 },
  headerCloseText: { fontSize: 17, fontWeight: "600" },
  headerTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },

  routeStrip: { maxHeight: 50, marginTop: 8 },
  routeStripContent: { paddingHorizontal: 12, gap: 8 },
  routePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  routePillIcon: { fontSize: 16 },
  routePillLabel: { fontSize: 13, fontWeight: "700" },

  profileStrip: { maxHeight: 44, marginTop: 6 },
  profileStripContent: { paddingHorizontal: 12, gap: 6 },
  profilePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  profilePillFlag: { fontSize: 16 },
  profilePillLabel: { fontSize: 12, fontWeight: "600" },

  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 12,
  },
  profileFlag: { fontSize: 36 },
  profileName: { fontSize: 20, fontWeight: "800" },
  profileSubtitle: { fontSize: 13, marginTop: 1 },

  sectionTabs: {
    flexDirection: "row",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    marginTop: 8,
  },
  sectionTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 4,
  },
  sectionTabIcon: { fontSize: 14 },
  sectionTabLabel: { fontSize: 12, fontWeight: "700" },

  scrollContent: { flex: 1 },
  scrollContentInner: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 12 },

  sectionContent: { gap: 8 },

  subheading: {
    fontSize: 15,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 4,
  },

  infoCard: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  infoCardIcon: { fontSize: 28, marginTop: 2 },
  infoCardBody: { flex: 1 },
  infoCardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  infoCardDetail: { fontSize: 13, lineHeight: 18 },

  requestRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  requestBullet: { fontSize: 16, fontWeight: "700" },
  requestText: { fontSize: 13, flex: 1, lineHeight: 18 },

  tipRow: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
    alignItems: "flex-start",
  },
  tipIcon: { fontSize: 20 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18 },

  phraseCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
  },
  phraseSituation: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  phraseNative: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  phrasePronunciation: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  phraseEnglish: { fontSize: 13 },
});
