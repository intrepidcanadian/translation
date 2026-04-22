import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "../services/logger";

const STREAK_KEY = "usage_streak";

interface Streak {
  current: number;
  lastDate: string;
}

interface StreakContextValue {
  streak: Streak;
  updateStreak: () => void;
}

const StreakContext = createContext<StreakContextValue | null>(null);

export function StreakProvider({ children }: { children: React.ReactNode }) {
  const [streak, setStreak] = useState<Streak>({ current: 0, lastDate: "" });
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STREAK_KEY)
      .then((val) => {
        if (val) {
          try {
            const data = JSON.parse(val) as Streak;
            setStreak(data);
          } catch (err) {
            logger.warn("Storage", "Failed to parse streak JSON", err);
          }
        }
        loaded.current = true;
      })
      .catch((err) => logger.warn("Storage", "Failed to load streak", err));
  }, []);

  const updateStreak = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    setStreak((prev) => {
      if (prev.lastDate === today) return prev;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const newStreak = prev.lastDate === yesterday
        ? { current: prev.current + 1, lastDate: today }
        : { current: 1, lastDate: today };
      AsyncStorage.setItem(STREAK_KEY, JSON.stringify(newStreak)).catch((err) =>
        logger.warn("Storage", "Failed to persist streak", err)
      );
      return newStreak;
    });
  }, []);

  const value = useMemo(() => ({ streak, updateStreak }), [streak, updateStreak]);

  return (
    <StreakContext.Provider value={value}>{children}</StreakContext.Provider>
  );
}

export function useStreak(): StreakContextValue {
  const ctx = useContext(StreakContext);
  if (!ctx) throw new Error("useStreak must be used within a StreakProvider");
  return ctx;
}
