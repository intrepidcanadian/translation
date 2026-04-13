import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Platform,
  Share,
  Alert,
  Modal,
} from "react-native";
import { loadNotes, deleteNote, updateNoteTitle, clearAllNotes, type SavedNote } from "../services/notes";
import { getScannerMode } from "../services/scannerModes";
import { logger } from "../services/logger";
import * as Clipboard from "expo-clipboard";
import { notifySuccess, notifyWarning } from "../services/haptics";
import type { ThemeColors } from "../theme";

interface NotesViewerProps {
  visible: boolean;
  onClose: () => void;
  hapticsEnabled?: boolean;
  colors: ThemeColors;
  refreshKey?: number; // increment to trigger reload
}

export default function NotesViewer({
  visible,
  onClose,
  colors,
  refreshKey = 0,
}: NotesViewerProps) {
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [search, setSearch] = useState("");
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const loaded = await loadNotes();
    setNotes(loaded);
  }, []);

  useEffect(() => {
    if (visible) {
      reload();
      setSearch("");
      setSelectedNote(null);
    }
  }, [visible, refreshKey, reload]);

  const filtered = search.trim()
    ? notes.filter((n) =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.translatedText.toLowerCase().includes(search.toLowerCase()) ||
        n.originalText.toLowerCase().includes(search.toLowerCase())
      )
    : notes;

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
          await clearAllNotes();
          notifyWarning();
          setSelectedNote(null);
          reload();
        },
      },
    ]);
  }, [notes.length, reload]);

  const handleSaveTitle = useCallback(async () => {
    if (!selectedNote || !titleDraft.trim()) return;
    await updateNoteTitle(selectedNote.id, titleDraft.trim());
    setSelectedNote({ ...selectedNote, title: titleDraft.trim() });
    setEditingTitle(false);
    reload();
  }, [selectedNote, titleDraft, reload]);

  const handleShare = useCallback(async (note: SavedNote) => {
    try {
      await Share.share({ message: note.formattedNote });
    } catch (err) { logger.warn("Notes", "Note share failed", err); }
  }, []);

  const handleCopy = useCallback(async (text: string, id: string) => {
    await Clipboard.setStringAsync(text);
    notifySuccess();
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  if (!visible) return null;

  // ---- Note detail view ----
  if (selectedNote) {
    const mode = getScannerMode(selectedNote.scanMode);
    return (
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedNote(null)}>
        <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setSelectedNote(null)}>
              <Text style={[styles.headerAction, { color: colors.primary }]}>Back</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.titleText }]} numberOfLines={1}>
              {mode.icon} {mode.label}
            </Text>
            <TouchableOpacity onPress={() => handleShare(selectedNote)}>
              <Text style={[styles.headerAction, { color: colors.primary }]}>Share</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={[{ key: "content" }]}
            renderItem={() => (
              <View style={styles.detailContent}>
                {/* Title */}
                <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
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
                      <TouchableOpacity onPress={handleSaveTitle}>
                        <Text style={[styles.headerAction, { color: colors.primary }]}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => { setEditingTitle(true); setTitleDraft(selectedNote.title); }}>
                      <Text style={[styles.noteDetailTitle, { color: colors.titleText }]}>{selectedNote.title}</Text>
                      <Text style={[styles.editHint, { color: colors.dimText }]}>Tap to edit title</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Meta */}
                <View style={[styles.metaRow, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                  <Text style={[styles.metaText, { color: colors.dimText }]}>
                    {selectedNote.sourceLang.toUpperCase()} → {selectedNote.targetLang.toUpperCase()}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.dimText }]}>
                    {new Date(selectedNote.timestamp).toLocaleString()}
                  </Text>
                </View>

                {/* Extracted fields */}
                {selectedNote.fields.length > 0 && (
                  <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Key Information</Text>
                    {selectedNote.fields.map((f, i) => (
                      <TouchableOpacity
                        key={i}
                        style={styles.fieldRow}
                        onPress={() => handleCopy(f.value, `field_${i}`)}
                      >
                        <Text style={[styles.fieldLabel, { color: colors.dimText }]}>{f.label}</Text>
                        <Text style={[styles.fieldValue, { color: colors.primaryText }]}>
                          {copiedId === `field_${i}` ? "Copied!" : f.value}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Translated text */}
                <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Translation</Text>
                    <TouchableOpacity onPress={() => handleCopy(selectedNote.translatedText, "translated")}>
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
                <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.titleText }]}>Original</Text>
                    <TouchableOpacity onPress={() => handleCopy(selectedNote.originalText, "original")}>
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
                >
                  <Text style={styles.deleteButtonText}>Delete Note</Text>
                </TouchableOpacity>

                <View style={{ height: 40 }} />
              </View>
            )}
          />
        </View>
      </Modal>
    );
  }

  // ---- Notes list view ----
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.safeBg }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.headerAction, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.titleText }]}>Saved Notes</Text>
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={[styles.headerAction, { color: notes.length > 0 ? "#ef4444" : colors.dimText }]}>
              Clear
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <TextInput
            style={[styles.searchInput, { color: colors.primaryText }]}
            placeholder="Search notes..."
            placeholderTextColor={colors.dimText}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Text style={[styles.clearSearch, { color: colors.dimText }]}>X</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Notes list */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
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
          renderItem={({ item }) => {
            const mode = getScannerMode(item.scanMode);
            return (
              <TouchableOpacity
                style={[styles.noteCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
                onPress={() => {
                  setSelectedNote(item);
                  setEditingTitle(false);
                }}
                accessibilityLabel={`Note: ${item.title}`}
              >
                <View style={styles.noteCardHeader}>
                  <Text style={styles.noteCardIcon}>{mode.icon}</Text>
                  <View style={styles.noteCardMeta}>
                    <Text style={[styles.noteCardTitle, { color: colors.titleText }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[styles.noteCardSub, { color: colors.dimText }]}>
                      {mode.label} · {item.sourceLang.toUpperCase()} → {item.targetLang.toUpperCase()} · {formatTime(item.timestamp)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(item.id)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel="Delete note"
                  >
                    <Text style={[styles.deleteIcon, { color: colors.dimText }]}>X</Text>
                  </TouchableOpacity>
                </View>
                {item.fields.length > 0 && (
                  <View style={styles.noteCardFields}>
                    {item.fields.slice(0, 3).map((f, i) => (
                      <View key={i} style={[styles.fieldChip, { backgroundColor: colors.bubbleBg, borderColor: colors.border }]}>
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
          }}
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
