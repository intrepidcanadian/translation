import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  Platform,
  Share,
  Alert,
  Modal,
} from "react-native";
import { loadNotes, deleteNote, updateNoteTitle, clearAllNotes, type SavedNote } from "../services/notes";
import { getScannerMode } from "../services/scannerModes";
import { logger } from "../services/logger";
import { copyWithAutoClear } from "../services/clipboard";
import { notifySuccess, notifyWarning } from "../services/haptics";
import { useAutoClearFlag } from "../hooks/useAutoClearFlag";
import { glassSurface, type ThemeColors } from "../theme";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import GlassBackdrop from "./GlassBackdrop";

interface NotesViewerProps {
  visible: boolean;
  onClose: () => void;
  hapticsEnabled?: boolean;
  colors: ThemeColors;
  refreshKey?: number; // increment to trigger reload
}

interface NoteListCardProps {
  item: SavedNote;
  colors: ThemeColors;
  onSelect: (note: SavedNote) => void;
  onDelete: (id: string) => void;
}

const NoteListCard = React.memo(function NoteListCard({ item, colors, onSelect, onDelete }: NoteListCardProps) {
  const mode = getScannerMode(item.scanMode);
  const handleSelect = useCallback(() => onSelect(item), [onSelect, item]);
  const handleDelete = useCallback(() => onDelete(item.id), [onDelete, item.id]);
  return (
    <TouchableOpacity
      style={[styles.noteCard, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}
      activeOpacity={0.85}
      onPress={handleSelect}
      accessibilityRole="button"
      accessibilityLabel={`Note: ${item.title}`}
      accessibilityHint="Open this note"
    >
      <View style={styles.noteCardHeader}>
        <Text style={styles.noteCardIcon}>{mode.icon}</Text>
        <View style={styles.noteCardMeta}>
          <Text style={[styles.noteCardTitle, { color: colors.titleText }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.noteCardSub, { color: colors.dimText }]}>
            {mode.label} · {item.sourceLang.toUpperCase()} → {item.targetLang.toUpperCase()} · {formatRelativeTime(item.timestamp) ?? ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleDelete}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Delete note: ${item.title}`}
          accessibilityHint="Permanently delete this note"
        >
          <Text style={[styles.deleteIcon, { color: colors.dimText }]}>X</Text>
        </TouchableOpacity>
      </View>
      {item.fields.length > 0 && (
        <View style={styles.noteCardFields}>
          {item.fields.slice(0, 3).map((f) => (
            <View key={`${f.label}-${f.value}`} style={[styles.fieldChip, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
              <Text style={[styles.fieldChipText, { color: colors.primaryText }]} numberOfLines={1}>
                {f.label}: {f.value}
              </Text>
            </View>
          ))}
          {item.fields.length > 3 && (
            <Text style={[styles.moreFields, { color: colors.dimText }]}>
              +{item.fields.length - 3} more
            </Text>
          )}
        </View>
      )}
      <Text style={[styles.noteCardPreview, { color: colors.secondaryText }]} numberOfLines={2}>
        {item.translatedText}
      </Text>
    </TouchableOpacity>
  );
});

function NotesViewer({
  visible,
  onClose,
  colors,
  refreshKey = 0,
}: NotesViewerProps) {
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [copiedId, setCopiedId] = useAutoClearFlag<string>(1500);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const loaded = await loadNotes();
    setNotes(loaded);
  }, []);

  useEffect(() => {
    if (visible) {
      reload();
      setSearch("");
      setDebouncedSearch("");
      setSelectedNote(null);
    }
  }, [visible, refreshKey, reload]);

  // 300ms debounce on search to avoid filtering on every keystroke
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [search]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.translatedText.toLowerCase().includes(q) ||
      n.originalText.toLowerCase().includes(q)
    );
  }, [notes, debouncedSearch]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert("Delete Note", "Are you sure you want to delete this note?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteNote(id);
          notifyWarning();
          if (selectedNote?.id === id) setSelectedNote(null);
          reload();
        },
      },
    ]);
  }, [selectedNote, reload]);

  const handleClearAll = useCallback(() => {
    if (notes.length === 0) return;
    Alert.alert("Clear All Notes", `Delete all ${notes.length} notes?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete All",
        style: "destructive",
        onPress: async () => {
          try {
            await clearAllNotes();
            notifyWarning();
            setSelectedNote(null);
            reload();
          } catch (err) {
            logger.warn("Notes", "Failed to clear all notes", err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  }, [notes.length, reload]);

  const handleSaveTitle = useCallback(async () => {
    if (!selectedNote || !titleDraft.trim()) return;
    try {
      await updateNoteTitle(selectedNote.id, titleDraft.trim());
      setSelectedNote({ ...selectedNote, title: titleDraft.trim() });
      setEditingTitle(false);
      reload();
    } catch (err) {
      logger.warn("Notes", "Failed to save title", err instanceof Error ? err.message : String(err));
    }
  }, [selectedNote, titleDraft, reload]);

  const handleShare = useCallback(async (note: SavedNote) => {
    try {
      await Share.share({ message: note.formattedNote });
    } catch (err) { logger.warn("Notes", "Note share failed", err); }
  }, []);

  const handleSelectNote = useCallback((note: SavedNote) => {
    setSelectedNote(note);
    setEditingTitle(false);
  }, []);

  const keyExtractor = useCallback((item: SavedNote) => item.id, []);

  const renderNoteItem = useCallback(({ item }: { item: SavedNote }) => (
    <NoteListCard item={item} colors={colors} onSelect={handleSelectNote} onDelete={handleDelete} />
  ), [colors, handleSelectNote, handleDelete]);

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      // copyWithAutoClear: scanned notes may contain medical/personal data
      // from OCR'd documents, so the 60s auto-wipe applies here too. (#128)
      await copyWithAutoClear(text);
      notifySuccess();
      setCopiedId(id);
    } catch (err) {
      logger.warn("Notes", "Failed to copy to clipboard", err instanceof Error ? err.message : String(err));
    }
  }, []);

  if (!visible) return null;

  // ---- Note detail view ----
  if (selectedNote) {
    const mode = getScannerMode(selectedNote.scanMode);
    return (
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedNote(null)}>
        <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
          <GlassBackdrop />
          {/* Header */}
          <View style={[styles.header, { backgroundColor: colors.glassBg, borderBottomColor: colors.glassBorder }]}>
            <TouchableOpacity onPress={() => setSelectedNote(null)} accessibilityRole="button" accessibilityLabel="Back" accessibilityHint="Return to notes list">
              <Text style={[styles.headerAction, { color: colors.primary }]}>Back</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.titleText }]} numberOfLines={1}>
              {mode.icon} {mode.label}
            </Text>
            <TouchableOpacity onPress={() => handleShare(selectedNote)} accessibilityRole="button" accessibilityLabel="Share note" accessibilityHint="Share this note via other apps">
              <Text style={[styles.headerAction, { color: colors.primary }]}>Share</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
              <View style={styles.detailContent}>
                {/* Title */}
                <View style={[styles.section, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                  {editingTitle ? (
                    <View style={styles.titleEditRow}>
                      <TextInput
                        style={[styles.titleInput, { color: colors.primaryText, borderColor: colors.border }]}
                        value={titleDraft}
                        onChangeText={setTitleDraft}
                        autoFocus
                        onSubmitEditing={handleSaveTitle}
                        returnKeyType="done"
                      />
                      <TouchableOpacity onPress={handleSaveTitle} accessibilityRole="button" accessibilityLabel="Save title" accessibilityHint="Save the edited note title">
                        <Text style={[styles.headerAction, { color: colors.primary }]}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => { setEditingTitle(true); setTitleDraft(selectedNote.title); }} accessibilityRole="button" accessibilityLabel={`Edit title: ${selectedNote.title}`} accessibilityHint="Tap to edit the note title">
                      <Text style={[styles.noteDetailTitle, { color: colors.titleText }]}>{selectedNote.title}</Text>
                      <Text style={[styles.editHint, { color: colors.dimText }]}>Tap to edit title</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Meta */}
                <View style={[styles.metaRow, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                  <Text style={[styles.metaText, { color: colors.dimText }]}>
                    {selectedNote.sourceLang.toUpperCase()} → {selectedNote.targetLang.toUpperCase()}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.dimText }]}>
                    {new Date(selectedNote.timestamp).toLocaleString()}
                  </Text>
                </View>

                {/* Extracted fields */}
                {selectedNote.fields.length > 0 && (
                  <View style={[styles.section, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                    <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Key Information</Text>
                    {selectedNote.fields.map((f) => {
                      const fieldKey = `${f.label}-${f.value}`;
                      return (
                        <TouchableOpacity
                          key={fieldKey}
                          style={styles.fieldRow}
                          onPress={() => handleCopy(f.value, fieldKey)}
                          accessibilityRole="button"
                          accessibilityLabel={`${f.label}: ${f.value}`}
                          accessibilityHint="Tap to copy this field value"
                        >
                          <Text style={[styles.fieldLabel, { color: colors.dimText }]}>{f.label}</Text>
                          <Text style={[styles.fieldValue, { color: colors.primaryText }]}>
                            {copiedId === fieldKey ? "Copied!" : f.value}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Translated text */}
                <View style={[styles.section, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Translation</Text>
                    <TouchableOpacity onPress={() => handleCopy(selectedNote.translatedText, "translated")} accessibilityRole="button" accessibilityLabel="Copy translation" accessibilityHint="Copy the translated text to clipboard">
                      <Text style={[styles.headerAction, { color: colors.primary }]}>
                        {copiedId === "translated" ? "Copied!" : "Copy"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.noteText, { color: colors.translatedText }]} selectable>
                    {selectedNote.translatedText}
                  </Text>
                </View>

                {/* Original text */}
                <View style={[styles.section, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Original</Text>
                    <TouchableOpacity onPress={() => handleCopy(selectedNote.originalText, "original")} accessibilityRole="button" accessibilityLabel="Copy original" accessibilityHint="Copy the original text to clipboard">
                      <Text style={[styles.headerAction, { color: colors.primary }]}>
                        {copiedId === "original" ? "Copied!" : "Copy"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.noteText, { color: colors.secondaryText }]} selectable>
                    {selectedNote.originalText}
                  </Text>
                </View>

                {/* Delete button */}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(selectedNote.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete note"
                  accessibilityHint="Permanently delete this note"
                >
                  <Text style={styles.deleteButtonText}>Delete Note</Text>
                </TouchableOpacity>

                <View style={{ height: 40 }} />
              </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  // ---- Notes list view ----
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
        <GlassBackdrop />
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.glassBg, borderBottomColor: colors.glassBorder }]}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" accessibilityHint="Close notes viewer">
            <Text style={[styles.headerAction, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.titleText }]}>Saved Notes</Text>
          <TouchableOpacity onPress={handleClearAll} accessibilityRole="button" accessibilityLabel="Clear all notes" accessibilityHint={notes.length > 0 ? `Delete all ${notes.length} notes` : "No notes to clear"}>
            <Text style={[styles.headerAction, { color: notes.length > 0 ? "#ef4444" : colors.dimText }]}>
              Clear
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchContainer, glassSurface, { backgroundColor: colors.glassBg, borderColor: colors.glassBorder }]}>
          <TextInput
            style={[styles.searchInput, { color: colors.primaryText }]}
            placeholder="Search notes..."
            placeholderTextColor={colors.dimText}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {debouncedSearch.length > 0 && (
            <Text
              style={[styles.searchCount, { color: colors.dimText }]}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${filtered.length} ${filtered.length === 1 ? "result" : "results"}`}
            >
              {filtered.length}
            </Text>
          )}
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} accessibilityRole="button" accessibilityLabel="Clear search" accessibilityHint="Clear the search field">
              <Text style={[styles.clearSearch, { color: colors.dimText }]}>X</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Notes list */}
        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={[styles.emptyIcon]}>📝</Text>
              <Text style={[styles.emptyText, { color: colors.dimText }]}>
                {search ? "No matching notes" : "No saved notes yet"}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.dimText }]}>
                {search ? "Try a different search" : "Scan a document and tap 'Save as Note'"}
              </Text>
            </View>
          }
          renderItem={renderNoteItem}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 54 : 40,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  headerAction: {
    fontSize: 16,
    fontWeight: "600",
  },
  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  searchCount: { fontSize: 12, fontWeight: "700", marginLeft: 6, minWidth: 20, textAlign: "center" },
  clearSearch: {
    fontSize: 16,
    fontWeight: "700",
    padding: 4,
  },
  // List
  listContent: {
    padding: 12,
    paddingTop: 0,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    alignItems: "center",
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: "center",
  },
  // Note card
  noteCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  noteCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  noteCardIcon: {
    fontSize: 24,
  },
  noteCardMeta: {
    flex: 1,
  },
  noteCardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  noteCardSub: {
    fontSize: 12,
    marginTop: 2,
  },
  deleteIcon: {
    fontSize: 16,
    fontWeight: "700",
    padding: 4,
  },
  noteCardFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  fieldChip: {
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderWidth: 1,
    maxWidth: "80%",
  },
  fieldChipText: {
    fontSize: 12,
  },
  moreFields: {
    fontSize: 12,
    alignSelf: "center",
  },
  noteCardPreview: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Detail view
  detailContent: {
    padding: 16,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  noteDetailTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  editHint: {
    fontSize: 12,
    marginTop: 4,
  },
  titleEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  titleInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  metaText: {
    fontSize: 13,
    fontWeight: "500",
  },
  fieldRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 15,
  },
  noteText: {
    fontSize: 15,
    lineHeight: 22,
  },
  deleteButton: {
    backgroundColor: "#ef4444",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});

export default React.memo(NotesViewer);
