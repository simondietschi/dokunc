"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { isValidIcon } from "@/lib/page-meta";

const GROUPS: { name: string; emojis: string[] }[] = [
  {
    name: "Häufig",
    emojis: ["📄", "📝", "📌", "⭐", "✅", "🚀", "💡", "🔥", "🎯", "📚", "🛠️", "⚙️", "🔒", "🧭", "📊", "📅", "🗂️", "🧪", "🐛", "🎉"],
  },
  {
    name: "Arbeit",
    emojis: ["💻", "🖥️", "📱", "🔧", "🔑", "📦", "🗃️", "📋", "📎", "🧾", "🏷️", "🔔", "💬", "📣", "🧩", "🪄", "🧱", "🔭", "🧲", "📡"],
  },
  {
    name: "Symbole",
    emojis: ["❗", "❓", "⚠️", "✨", "♻️", "🔁", "⏳", "🆕", "🚧", "🛑", "✔️", "➕", "🔗", "🔍", "📍", "🏁", "🎓", "🏆", "💎", "🧿"],
  },
  {
    name: "Natur",
    emojis: ["🌱", "🌳", "🌊", "☀️", "🌙", "⚡", "🌈", "🍀", "🌍", "🔮", "🐙", "🦄", "🐝", "🦊", "🐢", "🐧", "🦉", "🐳", "🌸", "🍎"],
  },
  {
    name: "Menschen",
    emojis: ["👋", "👀", "🧠", "💪", "🙌", "🤝", "👤", "👥", "🧑‍💻", "🧑‍🔧", "🧑‍🎨", "🧑‍🚀", "🎨", "🎭", "🧘", "🏃", "🎮", "🎧", "☕", "🍕"],
  },
];

/**
 * Kompakter Emoji-Picker ohne externe Bibliothek: kuratierte Gruppen
 * plus Freitext (beliebiges Emoji/Zeichen einfügen).
 */
export function EmojiPicker({
  value,
  onSelect,
  onClose,
}: {
  value: string | null;
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  const customOk = custom.trim() === "" || isValidIcon(custom.trim());

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Icon wählen"
      className="absolute left-0 top-full z-40 mt-2 w-[300px] rounded-xl border border-line bg-elevated p-2 shadow-pop animate-[rise_0.2s_ease]"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom.trim() && customOk) {
              onSelect(custom.trim());
            }
          }}
          placeholder="Eigenes Emoji einfügen…"
          aria-label="Eigenes Emoji"
          className={cn(
            "h-8 flex-1 rounded-lg border bg-surface px-2.5 text-[13px] outline-none focus:border-accent/60",
            customOk ? "border-line-strong" : "border-danger",
          )}
        />
        {value && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="h-8 rounded-lg px-2.5 text-[12px] text-muted hover:bg-subtle hover:text-ink"
          >
            Entfernen
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto px-1">
        {GROUPS.map((g) => (
          <div key={g.name} className="mb-1.5">
            <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
              {g.name}
            </p>
            <div className="grid grid-cols-10 gap-0.5">
              {g.emojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onSelect(e)}
                  title={e}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-md text-[17px] leading-none transition-colors hover:bg-subtle",
                    value === e && "bg-accent-soft",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
