import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { romanizeAligned, getRomanizationName, type AlignedPair } from "../services/romanization";

interface Props {
  text: string;
  langCode: string;
  textColor: string;
  romanColor: string;
  fontSize?: number;
}

function AlignedRomanizationBase({ text, langCode, textColor, romanColor, fontSize = 16 }: Props) {
  const pairs = useMemo(() => romanizeAligned(text, langCode), [text, langCode]);

  if (!pairs) return null;

  const romanFontSize = Math.max(10, fontSize * 0.65);
  const label = getRomanizationName(langCode);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: romanColor, fontSize: romanFontSize - 1 }]}>
        {label}
      </Text>
      <View style={styles.row}>
        {pairs.map((pair, i) => {
          // Space characters — render as a small gap
          if (pair.char === " ") {
            return <View key={i} style={styles.space} />;
          }

          return (
            <View key={i} style={styles.pair}>
              <Text
                style={[
                  styles.roman,
                  { color: romanColor, fontSize: romanFontSize },
                ]}
                numberOfLines={1}
              >
                {pair.roman || " "}
              </Text>
              <Text
                style={[
                  styles.char,
                  { color: textColor, fontSize },
                ]}
              >
                {pair.char}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Memoized: re-renders only when text/langCode/colors/fontSize actually change.
// Parent list rows pass stable theme colors by reference, so this avoids
// rebuilding the romanization pair layout on unrelated parent updates.
const AlignedRomanization = React.memo(AlignedRomanizationBase);
export default AlignedRomanization;

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
  label: {
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  pair: {
    alignItems: "center",
    marginHorizontal: 1,
  },
  roman: {
    fontStyle: "italic",
    marginBottom: 1,
  },
  char: {
    lineHeight: undefined, // let it auto-size
  },
  space: {
    width: 8,
  },
});
