import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { romanizeAligned, getRomanizationName } from "../services/romanization";

interface Props {
  text: string;
  langCode: string;
  textColor: string;
  romanColor: string;
  fontSize?: number;
}

const RomanPair = React.memo(function RomanPair({
  char,
  roman,
  textColor,
  romanColor,
  fontSize,
  romanFontSize,
}: {
  char: string;
  roman: string;
  textColor: string;
  romanColor: string;
  fontSize: number;
  romanFontSize: number;
}) {
  if (char === " ") {
    return <View style={styles.space} />;
  }

  return (
    <View style={styles.pair}>
      <Text
        style={[styles.roman, { color: romanColor, fontSize: romanFontSize }]}
        numberOfLines={1}
      >
        {roman || " "}
      </Text>
      <Text style={[styles.char, { color: textColor, fontSize }]}>
        {char}
      </Text>
    </View>
  );
});

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
        {pairs.map((pair, i) => (
          <RomanPair
            key={`${i}-${pair.char}`}
            char={pair.char}
            roman={pair.roman}
            textColor={textColor}
            romanColor={romanColor}
            fontSize={fontSize}
            romanFontSize={romanFontSize}
          />
        ))}
      </View>
    </View>
  );
}

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
