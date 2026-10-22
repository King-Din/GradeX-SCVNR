import { useCallback, useEffect, useRef, useState } from "react";

// Unsent text (task brief, score feedback, decision notes) is kept in this
// tab's sessionStorage, so a session that ends mid-sentence doesn't lose it.
// Cleared on a deliberate sign-out so the next person on the device never sees it.
const PREFIX = "gradex.draft.";

export const drafts = {
  get(key) {
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
  clear(key) {
    try { sessionStorage.removeItem(PREFIX + key); } catch { /* nothing stored */ }
  },
  clearAll() {
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* nothing stored */ }
  }
};

/*
 * useState that autosaves to a draft. `initial` is used when there's no draft.
 * Returns [value, setValue, clearDraft, restored]. A value equal to `initial`
 * removes the draft rather than saving it.
 */
export function useDraft(key, initial) {
  const [restored] = useState(() => (key ? drafts.get(key) != null : false));
  const [value, setValue] = useState(() => {
    const saved = key ? drafts.get(key) : null;
    return saved ?? initial;
  });
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!key) return;
    if (JSON.stringify(value) === JSON.stringify(initialRef.current)) drafts.clear(key);
    else drafts.set(key, value);
  }, [key, value]);

  const clear = useCallback(() => {
    if (key) drafts.clear(key);
  }, [key]);

  return [value, setValue, clear, restored];
}
