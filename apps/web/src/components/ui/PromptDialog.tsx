"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";

/**
 * Ersatz für window.prompt: ein echter Dialog mit einem Eingabefeld.
 * Kontrolliert von aussen, damit der Aufrufer den Fokus im Editor
 * gezielt zurückgeben kann.
 */
export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  initialValue = "",
  submitLabel = "Übernehmen",
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement>(null);

  // Beim Öffnen auf den übergebenen Startwert zurücksetzen.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      initialFocus={input}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={submit} disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-muted">
          {label}
        </span>
        <Input
          ref={input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Dialog>
  );
}
