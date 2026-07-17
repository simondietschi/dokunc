/** Gestaffelte Eingangs-Animation für Auth-Seiten (Formularseite). */
export function stagger(i: number): React.CSSProperties {
  return {
    animation: "rise 0.5s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${80 + i * 60}ms`,
  };
}
