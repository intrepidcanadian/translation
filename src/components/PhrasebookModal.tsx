import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
  PHRASE_CATEGORIES,
  getPhrasesForCategory,
  type PhraseCategory,
} from "../services/offlinePhrases";

interface PhrasebookModalProps {
  visible: boolean;
  onClose: () => void;
  sourceLangCode: string;
  targetLangCode: string;
  onCopy: (text: string) => void;
  onSpeak: (text: string, langCode: string) => void;
  hapticsEnabled: boolean;
  colors: any;
}

export default function PhrasebookModal({
  visible,
  onClose,
  sourceLangCode,
  targetLangCode,
  onCopy,
  onSpeak,
  hapticsEnabled,
  colors,
}: PhrasebookModalProps) {
  const [phraseCategory, setPhraseCategory] = useState<PhraseCategory>("greetings");

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.compareOverlay, { backgroundColor: colors.overlayBg }]}>
        <View style={[styles.phrasebookContent, { backgroundColor: colors.modalBg }]}>
          <Text style={[styles.compareTitle, { color: colors.titleText }]}>Phrasebook</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={PHRASE_CATEGORIES}
            keyExtractor={(item) => item.key}
            style={styles.phraseCategoryRow}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.phraseCategoryPill, { backgroundColor: phraseCategory === item.key ? colors.primary : colors.cardBg, borderColor: phraseCategory === item.key ? colors.primary : colors.border }]}
                onPress={() => setPhraseCategory(item.key)}
                accessibilityRole="button"
                accessibilityLabel={`${item.label} phrases`}
                accessibilityState={{ selected: phraseCategory === item.key }}
              >
                <Text style={styles.phraseCategoryIcon}>{item.icon}</Text>
                <Text style={[styles.phraseCategoryText, { color: phraseCategory === item.key ? "#ffffff" : colors.mutedText }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
          <FlatList
            data={getPhrasesForCategory(phraseCategory)}
            keyExtractor={(_, i) => `phrase-${phraseCategory}-${i}`}
            style={styles.phraseList}
            renderItem={({ item: phrase }) => {
              const srcText = (phrase as any)[sourceLangCode] || phrase.en;
              const tgtText = (phrase as any)[targetLangCode] || "";
              return (
                <TouchableOpacity
                  style={[styles.phraseItem, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}
                  onPress={() => {
                    if (tgtText) {
                      onCopy(tgtText);
                      if (hapticsEnabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                  }}
                  onLongPress={() => {
                    if (tgtText) {
                      onSpeak(tgtText, targetLangCode);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${srcText} translates to ${tgtText}. Tap to copy, long press to speak.`}
                >
                  <Text style={[styles.phraseSrcText, { color: colors.secondaryText }]}>{srcText}</Text>
                  {tgtText ? (
                    <Text style={[styles.phraseTgtText, { color: colors.translatedText }]}>{tgtText}</Text>
                  ) : (
                    <Text style={[styles.phraseTgtText, { color: colors.dimText, fontStyle: "italic" }]}>Not available</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
          <TouchableOpacity
            style={[styles.compareClose, { borderTopColor: colors.borderLight }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close phrasebook"
          >
            <Text style={[{ color: colors.primary, fontSize: 17, fontWeight: "600" as const }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  compareOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  compareTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  compareClose: {
    padding: 18,
    alignItems: "center",
    borderTopWidth: 1,
    marginHorizontal: -20,
  },
  phrasebookContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  phraseCategoryRow: {
    flexGrow: 0,
    marginBottom: 12,
  },
  phraseCategoryPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    borderWidth: 1,
    gap: 6,
  },
  phraseCategoryIcon: {
    fontSize: 14,
  },
  phraseCategoryText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  phraseList: {
    flex: 1,
  },
  phraseItem: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  phraseSrcText: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 4,
  },
  phraseTgtText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600" as const,
  },
});
