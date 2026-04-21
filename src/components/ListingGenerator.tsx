import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Share,
  Image,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type PhotoFile,
} from "react-native-vision-camera";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { getMLKitScript } from "../utils/getMLKitScript";
import { logger } from "../services/logger";
import { Linking } from "react-native";
import { copyWithAutoClear } from "../services/clipboard";
import { impactMedium, notifySuccess, impactLight } from "../services/haptics";
import { useAutoClearFlag } from "../hooks/useAutoClearFlag";
import {
  generateListing,
  generateSmartListing,
  translateListing,
  formatListingForShare,
  CATEGORY_OPTIONS,
  CONDITION_OPTIONS,
  type ListingDraft,
  type ListingCondition,
  type ListingCategory,
  type SmartListingInsights,
} from "../services/listingGenerator";
import { fetchPriceComps, type PriceCompResult } from "../services/productLookup";
import { translateText, type TranslationProvider } from "../services/translation";
import type { ThemeColors } from "../theme";

interface ListingGeneratorProps {
  visible: boolean;
  onClose: () => void;
  targetLangCode: string;
  translationProvider?: TranslationProvider;
  colors: ThemeColors;
}

type Phase = "camera" | "processing" | "editing";

const ConditionPill = React.memo(function ConditionPill({
  optKey,
  label,
  isSelected,
  onPress,
  activeBg,
  activeTextColor,
  inactiveBg,
  inactiveBorderColor,
  inactiveTextColor,
  style,
}: {
  optKey: ListingCondition;
  label: string;
  isSelected: boolean;
  onPress: (key: ListingCondition) => void;
  activeBg: string;
  activeTextColor: string;
  inactiveBg: string;
  inactiveBorderColor: string;
  inactiveTextColor: string;
  style: "camera" | "editing";
}) {
  const handlePress = useCallback(() => onPress(optKey), [onPress, optKey]);
  return (
    <TouchableOpacity
      style={[
        style === "camera" ? styles.conditionPill : styles.conditionEditPill,
        { backgroundColor: isSelected ? activeBg : inactiveBg, borderColor: isSelected ? activeBg : inactiveBorderColor },
      ]}
      onPress={handlePress}
      accessibilityRole="radio"
      accessibilityLabel={`Condition: ${label}`}
      accessibilityState={{ selected: isSelected }}
    >
      <Text style={[style === "camera" ? styles.conditionText : styles.conditionEditText, { color: isSelected ? activeTextColor : inactiveTextColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});

const CategoryPill = React.memo(function CategoryPill({
  optKey,
  label,
  icon,
  isSelected,
  onPress,
  activeBg,
  activeTextColor,
  inactiveBg,
  inactiveBorderColor,
  inactiveTextColor,
}: {
  optKey: ListingCategory;
  label: string;
  icon: string;
  isSelected: boolean;
  onPress: (key: ListingCategory) => void;
  activeBg: string;
  activeTextColor: string;
  inactiveBg: string;
  inactiveBorderColor: string;
  inactiveTextColor: string;
}) {
  const handlePress = useCallback(() => onPress(optKey), [onPress, optKey]);
  return (
    <TouchableOpacity
      style={[
        styles.categoryPill,
        { backgroundColor: isSelected ? activeBg : inactiveBg, borderColor: isSelected ? activeBg : inactiveBorderColor },
      ]}
      onPress={handlePress}
      accessibilityRole="radio"
      accessibilityLabel={`Category: ${label}`}
      accessibilityState={{ selected: isSelected }}
    >
      <Text style={styles.categoryIcon}>{icon}</Text>
      <Text style={[styles.categoryText, { color: isSelected ? activeTextColor : inactiveTextColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});

function ListingGenerator({
  visible,
  onClose,
  targetLangCode,
  translationProvider,
  colors,
}: ListingGeneratorProps) {
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [condition, setCondition] = useState<ListingCondition>("good");
  const [category, setCategory] = useState<ListingCategory>("other");
  const [price, setPrice] = useState("");
  const [priceComps, setPriceComps] = useState<PriceCompResult | null>(null);
  const [isCheckingPrice, setIsCheckingPrice] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [copiedField, setCopiedField] = useAutoClearFlag<string>(1500);

  useEffect(() => {
    if (visible && !hasPermission) requestPermission();
    return () => { abortRef.current?.abort(); };
  }, [visible, hasPermission, requestPermission]);

  const resetToCamera = useCallback(() => {
    setPhase("camera");
    setPhotoUri(null);
    setOcrText("");
    setDraft(null);
    setEditTitle("");
    setEditDescription("");
    setPrice("");
    setPriceComps(null);
    setIsCheckingPrice(false);
    setIsTranslating(false);
  }, []);

  const handleConditionPress = useCallback((key: ListingCondition) => {
    setCondition(key);
    impactLight();
  }, []);

  const handleCategoryPress = useCallback((key: ListingCategory) => {
    setCategory(key);
    impactLight();
  }, []);

  const captureAndProcess = useCallback(async () => {
    if (!cameraRef.current) return;
    impactMedium();
    setPhase("processing");

    try {
      const photo: PhotoFile = await cameraRef.current.takePhoto({ enableShutterSound: true });
      const imageUri = Platform.OS === "android" ? `file://${photo.path}` : photo.path;
      setPhotoUri(imageUri);

      // OCR
      const result = await TextRecognition.recognize(imageUri, getMLKitScript("en"));
      const fullText = result.blocks.map((b) => b.text).join("\n");
      setOcrText(fullText);

      // Generate smart listing (uses Neural Engine when available)
      const listing = await generateSmartListing(fullText, condition);
      setDraft(listing);
      setEditTitle(listing.title);
      setEditDescription(listing.description);
      setCategory(listing.category);

      // Auto-fill price from detected prices
      if (listing.insights?.detectedPrices.length) {
        const firstPrice = listing.insights.detectedPrices[0];
        const numericPrice = firstPrice.replace(/[^0-9.]/g, "");
        if (numericPrice) setPrice(numericPrice);
      }

      setPhase("editing");
      notifySuccess();
    } catch (err) {
      logger.warn("Listing", "Listing capture failed", err);
      setPhase("camera");
    }
  }, [condition]);

  const regenerateListing = useCallback(() => {
    if (!ocrText) return;
    const listing = generateListing(ocrText, condition, editTitle !== draft?.title ? editTitle : undefined, category);
    setDraft(listing);
    setEditTitle(listing.title);
    setEditDescription(listing.description);
  }, [ocrText, condition, category, editTitle, draft?.title]);

  const handleTranslate = useCallback(async () => {
    if (!draft) return;
    setIsTranslating(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const updated: ListingDraft = { ...draft, title: editTitle, description: editDescription };
      const translated = await translateListing(updated, targetLangCode, translationProvider, controller.signal);
      if (!controller.signal.aborted) {
        setDraft(translated);
        notifySuccess();
      }
    } catch (err) {
      if (!controller.signal.aborted) logger.warn("Listing", "Listing translation failed", err);
    } finally {
      if (!controller.signal.aborted) setIsTranslating(false);
    }
  }, [draft, editTitle, editDescription, targetLangCode, translationProvider]);

  const handlePriceCheck = useCallback(async () => {
    if (!draft) return;
    setIsCheckingPrice(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Build search query from brand/model/title
      const query = editTitle || draft.title;
      const comps = await fetchPriceComps(query, controller.signal);
      if (!controller.signal.aborted) {
        setPriceComps(comps);
        impactLight();
      }
    } catch (err) {
      if (!controller.signal.aborted) logger.warn("Product", "Price check failed", err);
    } finally {
      if (!controller.signal.aborted) setIsCheckingPrice(false);
    }
  }, [draft, editTitle]);

  const handleShare = useCallback(async () => {
    if (!draft) return;
    const finalDraft: ListingDraft = { ...draft, title: editTitle, description: editDescription, price: price || undefined };
    const text = formatListingForShare(finalDraft, !!draft.translatedTitle);
    try {
      await Share.share({ message: text });
    } catch (err) {
      logger.warn("Listing", "Listing share failed", err);
    }
  }, [draft, editTitle, editDescription, price]);

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      // copyWithAutoClear: listing drafts may contain price / contact info
      // the seller pastes into marketplaces; 60s auto-wipe matches the rest
      // of the app's content-copy UX. (#128)
      await copyWithAutoClear(text);
      impactLight();
      setCopiedField(field);
    } catch (err) {
      logger.warn("Listing", "Copy to clipboard failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleAddBrand = useCallback(() => {
    if (draft?.insights?.suggestedBrand && !editTitle.includes(draft.insights.suggestedBrand)) {
      setEditTitle(draft.insights.suggestedBrand + " " + editTitle);
    }
  }, [draft, editTitle]);

  const handleAddModel = useCallback(() => {
    if (draft?.insights?.suggestedModel && !editTitle.includes(draft.insights.suggestedModel)) {
      setEditTitle(editTitle + " " + draft.insights.suggestedModel);
    }
  }, [draft, editTitle]);

  const handleSetPrice = useCallback((p: string) => {
    const numericPrice = p.replace(/[^0-9.]/g, "");
    if (numericPrice) setPrice(numericPrice);
  }, []);

  const handleCopyAll = useCallback(() => {
    if (!draft) return;
    const fullText = formatListingForShare(
      { ...draft, title: editTitle, description: editDescription, price: price || undefined },
      !!draft.translatedTitle
    );
    handleCopy(fullText, "fullListing");
  }, [draft, editTitle, editDescription, price, handleCopy]);

  if (!visible) return null;

  if (!device || !hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.containerBg }]}>
        <Text style={[styles.permText, { color: colors.primaryText }]}>
          {!device ? "No camera device found" : "Camera permission required"}
        </Text>
        {!hasPermission && (
          <TouchableOpacity onPress={requestPermission} style={[styles.permBtn, { backgroundColor: colors.primary }]} accessibilityRole="button" accessibilityLabel="Grant camera permission" accessibilityHint="Opens system permission dialog">
            <Text style={{ color: colors.destructiveText, fontWeight: "700" }}>Grant Permission</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera phase */}
      {phase === "camera" && (
        <View style={styles.cameraContainer}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible && phase === "camera"}
            photo
          />
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraHint}>Take a photo of the item you want to sell</Text>
            <View style={styles.conditionRow}>
              {CONDITION_OPTIONS.map((opt) => (
                <ConditionPill
                  key={opt.key}
                  optKey={opt.key}
                  label={opt.label}
                  isSelected={condition === opt.key}
                  onPress={handleConditionPress}
                  activeBg={colors.primary}
                  activeTextColor={colors.destructiveText}
                  inactiveBg="rgba(0,0,0,0.5)"
                  inactiveBorderColor="rgba(255,255,255,0.3)"
                  inactiveTextColor="#fff"
                  style="camera"
                />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.captureBtn, { backgroundColor: colors.primary }]}
              onPress={captureAndProcess}
              accessibilityRole="button"
              accessibilityLabel="Capture photo for listing"
              accessibilityHint="Takes a photo and generates a marketplace listing"
            >
              <View style={styles.captureInner} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Processing */}
      {phase === "processing" && (
        <View style={[styles.centerContainer, { backgroundColor: colors.containerBg }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.processingText, { color: colors.primaryText }]}>Analyzing item...</Text>
          <Text style={[styles.processingSubtext, { color: colors.mutedText }]}>Reading text and generating listing</Text>
        </View>
      )}

      {/* Editing phase */}
      {phase === "editing" && draft && (
        <ScrollView
          style={[styles.editContainer, { backgroundColor: colors.containerBg }]}
          contentContainerStyle={styles.editContent}
          keyboardDismissMode="on-drag"
        >
          {/* Photo preview */}
          {photoUri && (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
          )}

          {/* AI Insights Card */}
          {draft.insights && draft.insights.confidence > 0 && (
            <View style={[styles.insightsCard, { backgroundColor: colors.cardBg, borderColor: colors.primary + "40" }]}>
              <View style={styles.insightsHeader}>
                <Text style={styles.insightsIcon}>🧠</Text>
                <Text style={[styles.insightsTitle, { color: colors.primary }]}>
                  Neural Engine Analysis
                </Text>
                <View style={[styles.confidenceBadge, { backgroundColor: colors.primary + "20" }]}>
                  <Text style={[styles.confidenceText, { color: colors.primary }]}>
                    {Math.round(draft.insights.confidence * 100)}%
                  </Text>
                </View>
              </View>

              {/* Detected brand/model */}
              {(draft.insights.suggestedBrand || draft.insights.suggestedModel) && (
                <View style={styles.insightsRow}>
                  {draft.insights.suggestedBrand && (
                    <TouchableOpacity
                      style={[styles.insightChip, { backgroundColor: colors.successBg }]}
                      onPress={handleAddBrand}
                      accessibilityRole="button"
                      accessibilityLabel={`Add brand: ${draft.insights.suggestedBrand}`}
                      accessibilityHint="Tap to add this brand to your listing title"
                    >
                      <Text style={[styles.insightChipLabel, { color: colors.dimText }]}>Brand</Text>
                      <Text style={[styles.insightChipValue, { color: colors.successText }]}>
                        {draft.insights.suggestedBrand}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {draft.insights.suggestedModel && (
                    <TouchableOpacity
                      style={[styles.insightChip, { backgroundColor: colors.successBg }]}
                      onPress={handleAddModel}
                      accessibilityRole="button"
                      accessibilityLabel={`Add model: ${draft.insights.suggestedModel}`}
                      accessibilityHint="Tap to add this model to your listing title"
                    >
                      <Text style={[styles.insightChipLabel, { color: colors.dimText }]}>Model</Text>
                      <Text style={[styles.insightChipValue, { color: colors.successText }]}>
                        {draft.insights.suggestedModel}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Detected specs */}
              {draft.insights.keySpecs.length > 0 && (
                <View style={styles.specsGrid}>
                  {draft.insights.keySpecs.slice(0, 6).map((spec) => (
                    <View key={spec.label} style={[styles.specItem, { backgroundColor: colors.sectionBg }]}>
                      <Text style={[styles.specLabel, { color: colors.dimText }]}>{spec.label}</Text>
                      <Text style={[styles.specValue, { color: colors.primaryText }]}>{spec.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Detected prices */}
              {draft.insights.detectedPrices.length > 0 && (
                <View style={styles.insightsRow}>
                  <Text style={[styles.insightPriceLabel, { color: colors.dimText }]}>Detected prices: </Text>
                  {draft.insights.detectedPrices.slice(0, 3).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.priceBubble, { backgroundColor: colors.warningBg }]}
                      onPress={() => {
                        const numericPrice = p.replace(/[^0-9.]/g, "");
                        if (numericPrice) setPrice(numericPrice);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Use detected price: ${p}`}
                      accessibilityHint="Tap to set this as your listing price"
                    >
                      <Text style={[styles.priceBubbleText, { color: colors.warningText }]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.insightsHint, { color: colors.dimText }]}>
                Tap chips to add to your listing
              </Text>
            </View>
          )}

          {/* Category selector */}
          <Text style={[styles.label, { color: colors.secondaryText }]}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            <View style={styles.categoryRow}>
              {CATEGORY_OPTIONS.map((opt) => (
                <CategoryPill
                  key={opt.key}
                  optKey={opt.key}
                  label={opt.label}
                  icon={opt.icon}
                  isSelected={category === opt.key}
                  onPress={handleCategoryPress}
                  activeBg={colors.primary}
                  activeTextColor={colors.destructiveText}
                  inactiveBg={colors.cardBg}
                  inactiveBorderColor={colors.border}
                  inactiveTextColor={colors.mutedText}
                />
              ))}
            </View>
          </ScrollView>

          {/* Condition selector */}
          <Text style={[styles.label, { color: colors.secondaryText }]}>Condition</Text>
          <View style={styles.conditionEditRow}>
            {CONDITION_OPTIONS.map((opt) => (
              <ConditionPill
                key={opt.key}
                optKey={opt.key}
                label={opt.label}
                isSelected={condition === opt.key}
                onPress={handleConditionPress}
                activeBg={colors.primary}
                activeTextColor={colors.destructiveText}
                inactiveBg={colors.cardBg}
                inactiveBorderColor={colors.border}
                inactiveTextColor={colors.mutedText}
                style="editing"
              />
            ))}
          </View>

          {/* Title */}
          <Text style={[styles.label, { color: colors.secondaryText }]}>Title</Text>
          <TextInput
            style={[styles.titleInput, { backgroundColor: colors.inputBg, color: colors.primaryText, borderColor: colors.border }]}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Listing title"
            placeholderTextColor={colors.placeholderText}
            maxLength={120}
            accessibilityLabel="Listing title"
            accessibilityHint="Enter a title for the marketplace listing"
          />

          {/* Description */}
          <Text style={[styles.label, { color: colors.secondaryText }]}>Description</Text>
          <TextInput
            style={[styles.descInput, { backgroundColor: colors.inputBg, color: colors.primaryText, borderColor: colors.border }]}
            value={editDescription}
            onChangeText={setEditDescription}
            placeholder="Listing description"
            placeholderTextColor={colors.placeholderText}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Listing description"
            accessibilityHint="Enter a description for the marketplace listing"
          />

          {/* Tags */}
          {draft.suggestedTags.length > 0 && (
            <View style={styles.tagsRow}>
              {draft.suggestedTags.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tagPill, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                  onPress={() => handleCopy(`#${tag.replace(/\s/g, "")}`, tag)}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy tag: #${tag.replace(/\s/g, "")}`}
                  accessibilityHint="Tap to copy this tag to clipboard"
                >
                  <Text style={[styles.tagText, { color: colors.mutedText }]}>
                    {copiedField === tag ? "Copied!" : `#${tag.replace(/\s/g, "")}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Price */}
          <Text style={[styles.label, { color: colors.secondaryText }]}>Price</Text>
          <View style={styles.priceRow}>
            <View style={[styles.priceInputWrap, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
              <Text style={[styles.priceCurrency, { color: colors.mutedText }]}>$</Text>
              <TextInput
                style={[styles.priceInput, { color: colors.primaryText }]}
                value={price}
                onChangeText={setPrice}
                placeholder="0.00"
                placeholderTextColor={colors.placeholderText}
                keyboardType="decimal-pad"
                maxLength={10}
                accessibilityLabel="Listing price"
                accessibilityHint="Enter the asking price for this item"
              />
            </View>
            <TouchableOpacity
              style={[styles.priceCheckBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
              onPress={handlePriceCheck}
              disabled={isCheckingPrice}
              accessibilityRole="button"
              accessibilityLabel="Price check"
              accessibilityHint="Check comparable prices on marketplaces"
              accessibilityState={{ disabled: isCheckingPrice }}
            >
              {isCheckingPrice ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.priceCheckText, { color: colors.primary }]}>Price Check</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Price Comps */}
          {priceComps && (
            <View style={[styles.priceCompsBox, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              {priceComps.retailPrice && (
                <View style={styles.retailPriceRow}>
                  <Text style={[styles.retailPriceLabel, { color: colors.mutedText }]}>
                    Retail ({priceComps.retailPrice.source}):
                  </Text>
                  <Text style={[styles.retailPriceValue, { color: colors.primary }]}>
                    {priceComps.retailPrice.price}
                  </Text>
                </View>
              )}
              <Text style={[styles.compLinksTitle, { color: colors.secondaryText }]}>
                Check comparable prices:
              </Text>
              {priceComps.links.map((link) => (
                <TouchableOpacity
                  key={link.name}
                  style={[styles.compLink, { borderColor: colors.border }]}
                  onPress={() => Linking.openURL(link.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`${link.name}: ${link.description}`}
                  accessibilityHint={`Opens ${link.name} in your browser`}
                >
                  <Text style={styles.compLinkIcon}>{link.icon}</Text>
                  <View style={styles.compLinkInfo}>
                    <Text style={[styles.compLinkName, { color: colors.primaryText }]}>{link.name}</Text>
                    <Text style={[styles.compLinkDesc, { color: colors.dimText }]}>{link.description}</Text>
                  </View>
                  <Text style={[styles.compLinkArrow, { color: colors.mutedText }]}>→</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Translation */}
          {draft.translatedTitle && (
            <View style={[styles.translationBox, { backgroundColor: colors.translatedBubbleBg, borderColor: colors.border }]}>
              <Text style={[styles.translationLabel, { color: colors.dimText }]}>
                Translated ({draft.targetLang?.toUpperCase()})
              </Text>
              <TouchableOpacity onPress={() => handleCopy(draft.translatedTitle!, "translatedTitle")} accessibilityRole="button" accessibilityLabel="Copy translated title" accessibilityHint="Tap to copy the translated title to clipboard">
                <Text style={[styles.translatedTitle, { color: colors.translatedText }]}>
                  {copiedField === "translatedTitle" ? "Copied!" : draft.translatedTitle}
                </Text>
              </TouchableOpacity>
              {draft.translatedDescription && (
                <TouchableOpacity onPress={() => handleCopy(draft.translatedDescription!, "translatedDesc")} accessibilityRole="button" accessibilityLabel="Copy translated description" accessibilityHint="Tap to copy the translated description to clipboard">
                  <Text style={[styles.translatedDesc, { color: colors.secondaryText }]} numberOfLines={6}>
                    {copiedField === "translatedDesc" ? "Copied!" : draft.translatedDescription}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1 }]}
              onPress={handleTranslate}
              disabled={isTranslating}
              accessibilityRole="button"
              accessibilityLabel={isTranslating ? "Translating listing" : "Translate listing"}
              accessibilityHint="Translate the listing to your target language"
              accessibilityState={{ disabled: isTranslating }}
            >
              {isTranslating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.actionBtnText, { color: colors.primary }]}>Translate</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share listing"
              accessibilityHint="Share the formatted listing via other apps"
            >
              <Text style={[styles.actionBtnText, { color: colors.destructiveText }]}>Share Listing</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1 }]}
              onPress={handleCopyAll}
              accessibilityRole="button"
              accessibilityLabel="Copy entire listing"
              accessibilityHint="Copy the full formatted listing to clipboard"
            >
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>
                {copiedField === "fullListing" ? "Copied!" : "Copy All"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1 }]}
              onPress={resetToCamera}
              accessibilityRole="button"
              accessibilityLabel="Retake photo"
              accessibilityHint="Go back to camera to take a new photo"
            >
              <Text style={[styles.actionBtnText, { color: colors.mutedText }]}>Retake Photo</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Back button */}
      <TouchableOpacity
        style={[styles.backBtn, { backgroundColor: phase === "camera" ? "rgba(0,0,0,0.5)" : colors.cardBg + "CC" }]}
        onPress={phase === "editing" ? resetToCamera : onClose}
        accessibilityRole="button"
        accessibilityLabel={phase === "editing" ? "Retake photo" : "Close listing generator"}
        accessibilityHint={phase === "editing" ? "Go back to camera to take a new photo" : "Returns to the scan screen"}
      >
        <Text style={[styles.backBtnText, { color: phase === "camera" ? "#fff" : colors.primaryText }]}>
          {phase === "camera" ? "✕" : "←"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cameraContainer: { flex: 1 },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 40,
  },
  cameraHint: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 16,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  conditionRow: { flexDirection: "row", gap: 8, marginBottom: 24, flexWrap: "wrap", justifyContent: "center" },
  conditionPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  conditionText: { fontSize: 12, fontWeight: "700" },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
  },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  processingText: { fontSize: 18, fontWeight: "700", marginTop: 16 },
  processingSubtext: { fontSize: 14, marginTop: 8 },
  editContainer: { flex: 1 },
  editContent: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  photoPreview: { width: "100%", height: 200, borderRadius: 12, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, marginTop: 12 },
  categoryScroll: { marginBottom: 4 },
  categoryRow: { flexDirection: "row", gap: 8 },
  categoryPill: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  categoryIcon: { fontSize: 14 },
  categoryText: { fontSize: 12, fontWeight: "600" },
  conditionEditRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  conditionEditPill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  conditionEditText: { fontSize: 13, fontWeight: "600" },
  titleInput: { borderRadius: 12, padding: 12, fontSize: 16, fontWeight: "600", borderWidth: 1 },
  descInput: { borderRadius: 12, padding: 12, fontSize: 14, borderWidth: 1, minHeight: 140, lineHeight: 20 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tagPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1 },
  tagText: { fontSize: 12, fontWeight: "600" },
  translationBox: { borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1 },
  translationLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  translatedTitle: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  translatedDesc: { fontSize: 13, lineHeight: 18 },
  priceRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  priceInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  priceCurrency: { fontSize: 18, fontWeight: "700", marginRight: 4 },
  priceInput: { flex: 1, fontSize: 18, fontWeight: "600", paddingVertical: 12 },
  priceCheckBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  priceCheckText: { fontSize: 14, fontWeight: "700" },
  priceCompsBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
  },
  retailPriceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.3)",
  },
  retailPriceLabel: { fontSize: 13, fontWeight: "600" },
  retailPriceValue: { fontSize: 18, fontWeight: "800" },
  compLinksTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  compLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  compLinkIcon: { fontSize: 18 },
  compLinkInfo: { flex: 1 },
  compLinkName: { fontSize: 14, fontWeight: "600" },
  compLinkDesc: { fontSize: 11, marginTop: 1 },
  compLinkArrow: { fontSize: 16, fontWeight: "600" },
  actionsRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionBtnText: { fontSize: 15, fontWeight: "700" },
  permText: { fontSize: 18, fontWeight: "600", textAlign: "center", padding: 40 },
  permBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  backBtn: {
    position: "absolute",
    top: Platform.OS === "android" ? 10 : 0,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  backBtnText: { fontSize: 18, fontWeight: "700" },

  // AI Insights card
  insightsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  insightsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  insightsIcon: { fontSize: 18 },
  insightsTitle: { fontSize: 14, fontWeight: "700", flex: 1 },
  confidenceBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  confidenceText: { fontSize: 12, fontWeight: "700" },
  insightsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  insightChip: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  insightChipLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  insightChipValue: { fontSize: 15, fontWeight: "700" },
  specsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  specItem: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
  },
  specLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  specValue: { fontSize: 13, fontWeight: "600" },
  insightPriceLabel: { fontSize: 12, fontWeight: "600" },
  priceBubble: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  priceBubbleText: { fontSize: 14, fontWeight: "700" },
  insightsHint: { fontSize: 11, fontStyle: "italic" },
});

export default React.memo(ListingGenerator);
