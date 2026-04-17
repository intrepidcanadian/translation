import React, { useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Share,
  Platform,
} from "react-native";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { LANGUAGE_MAP } from "../services/translation";
import { logger } from "../services/logger";
import type { ThemeColors } from "../theme";

interface TranslationShareCardProps {
  visible: boolean;
  onClose: () => void;
  original: string;
  translated: string;
  sourceLangCode?: string;
  targetLangCode?: string;
  confidence?: number | null;
  colors: ThemeColors;
}

function TranslationShareCard({
  visible,
  onClose,
  original,
  translated,
  sourceLangCode,
  targetLangCode,
  confidence,
  colors,
}: TranslationShareCardProps) {
  const viewShotRef = useRef<ViewShot>(null);

  const srcLang = sourceLangCode ? LANGUAGE_MAP.get(sourceLangCode) : null;
  const tgtLang = targetLangCode ? LANGUAGE_MAP.get(targetLangCode) : null;

  const handleShareImage = useCallback(async () => {
    try {
      const uri = await viewShotRef.current?.capture?.();
      if (!uri) return;

      if (Platform.OS === "ios" && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          UTI: "public.png",
        });
      } else {
        // Fallback to text share
        const card = [
          `"${original}"`,
          "",
          `→ "${translated}"`,
          "",
          srcLang && tgtLang ? `${srcLang.flag} ${srcLang.name} → ${tgtLang.flag} ${tgtLang.name}` : "",
          "— Live Translator",
        ].filter(Boolean).join("\n");
        await Share.share({ message: card });
      }
      onClose();
    } catch (err) {
      logger.warn("Translation", "Share card failed", err instanceof Error ? err.message : String(err));
    }
  }, [original, translated, srcLang, tgtLang, onClose]);

  const handleShareText = useCallback(async () => {
    const card = [
      `"${original}"`,
      "",
      `→ "${translated}"`,
      "",
      srcLang && tgtLang ? `${srcLang.flag} ${srcLang.name} → ${tgtLang.flag} ${tgtLang.name}` : "",
      "— Live Translator",
    ].filter(Boolean).join("\n");
    try {
      await Share.share({ message: card });
      onClose();
    } catch (err) {
      logger.warn("Translation", "Text share failed", err instanceof Error ? err.message : String(err));
    }
  }, [original, translated, srcLang, tgtLang, onClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay} accessibilityViewIsModal={true}>
        <View style={[styles.modalContainer, { backgroundColor: colors.cardBg }]}>
          {/* Preview of the share card */}
          <ViewShot
            ref={viewShotRef}
            options={{ format: "png", quality: 1.0 }}
            style={styles.viewShot}
          >
            <View style={styles.card}>
              {/* Gradient-like header */}
              <View style={styles.cardHeader}>
                <Text style={styles.cardAppName}>Live Translator</Text>
                {srcLang && tgtLang && (
                  <View style={styles.langBadgeRow}>
                    <View style={styles.langBadge}>
                      <Text style={styles.langFlag}>{srcLang.flag}</Text>
                      <Text style={styles.langName}>{srcLang.name}</Text>
                    </View>
                    <Text style={styles.arrowText}>→</Text>
                    <View style={styles.langBadge}>
                      <Text style={styles.langFlag}>{tgtLang.flag}</Text>
                      <Text style={styles.langName}>{tgtLang.name}</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Original text */}
              <View style={styles.cardSection}>
                <Text style={styles.sectionLabel}>Original</Text>
                <Text style={styles.originalText} numberOfLines={6}>
                  {original}
                </Text>
              </View>

              {/* Divider */}
              <View style={styles.divider} />

              {/* Translated text */}
              <View style={styles.cardSection}>
                <Text style={styles.sectionLabel}>Translation</Text>
                <Text style={styles.translatedText} numberOfLines={6}>
                  {translated}
                </Text>
              </View>

              {/* Footer */}
              <View style={styles.cardFooter}>
                {confidence != null && (
                  <Text style={styles.confidenceText}>
                    {Math.round(confidence * 100)}% match
                  </Text>
                )}
                <Text style={styles.brandingText}>Live Translator</Text>
              </View>
            </View>
          </ViewShot>

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={handleShareImage}
              accessibilityRole="button"
              accessibilityLabel="Share as image"
              accessibilityHint="Creates a branded image card and opens the share sheet"
            >
              <Text style={styles.actionBtnText}>Share as Image</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border }]}
              onPress={handleShareText}
              accessibilityRole="button"
              accessibilityLabel="Share as text"
              accessibilityHint="Opens the share sheet with a formatted text quote"
            >
              <Text style={[styles.actionBtnText, { color: colors.primaryText }]}>Share as Text</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel sharing"
          >
            <Text style={[styles.closeBtnText, { color: colors.mutedText }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default React.memo(TranslationShareCard);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContainer: {
    borderRadius: 20,
    padding: 20,
    width: "100%",
    maxWidth: 380,
  },
  viewShot: {
    borderRadius: 16,
    overflow: "hidden",
  },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    overflow: "hidden",
  },
  cardHeader: {
    backgroundColor: "#6c63ff",
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  cardAppName: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  langBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  langBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
  },
  langFlag: {
    fontSize: 16,
  },
  langName: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  arrowText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  cardSection: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sectionLabel: {
    color: "#8888aa",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  originalText: {
    color: "#c0c0d0",
    fontSize: 16,
    lineHeight: 22,
  },
  divider: {
    height: 1,
    backgroundColor: "#2a2a4e",
    marginHorizontal: 20,
  },
  translatedText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 26,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#2a2a4e",
  },
  confidenceText: {
    color: "#6c63ff",
    fontSize: 12,
    fontWeight: "600",
  },
  brandingText: {
    color: "#555577",
    fontSize: 11,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  actionBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  closeBtn: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
