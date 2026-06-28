import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'anke:theme-mode';

function readFromStorage(): ThemeMode {
  try {
    if (typeof localStorage === 'undefined') return 'light';
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
    // 初次打开：根据系统偏好推断
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

function writeToStorage(mode: ThemeMode): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readFromStorage();
  // 初次挂载时同步一次 document
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', initial);
  }
  return {
    mode: initial,
    setMode: (mode) => {
      if (mode === get().mode) return;
      writeToStorage(mode);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', mode);
      }
      set({ mode });
    },
    toggle: () => {
      const next: ThemeMode = get().mode === 'dark' ? 'light' : 'dark';
      writeToStorage(next);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
      }
      set({ mode: next });
    },
  };
});
