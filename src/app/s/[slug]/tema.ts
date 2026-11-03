/**
 * O site público sai sempre no tema claro (mesmo que o visitante tenha usado o
 * escuro no sistema): as variáveis do claro são aplicadas no contêiner do site,
 * e a cor da marca entra por cima (paletaMarca).
 */
export const TEMA_CLARO: Record<string, string> = {
  "--bg-app": "#f4f6f9",
  "--bg-card": "#ffffff",
  "--bg-card-hover": "#f0f3f7",
  "--bg-elev": "#f7f9fb",
  "--bg-input": "#f1f4f8",
  "--border": "#e3e8ef",
  "--border-strong": "#d0d7e0",
  "--border-soft": "#eef1f5",
  "--text-primary": "#1a2230",
  "--text-secondary": "#54606e",
  "--text-muted": "#828d9b",
  "--text-faint": "#aab2bd",
  "--bad": "#dc2626",
  "--bad-bg": "rgba(220, 38, 38, 0.08)",
  "--bad-bd": "rgba(220, 38, 38, 0.24)",
  "--warn": "#d97706",
  "--warn-bg": "rgba(217, 119, 6, 0.09)",
  "--warn-bd": "rgba(217, 119, 6, 0.26)",
  "--ok": "#16a34a",
  "--ok-bg": "rgba(22, 163, 74, 0.1)",
  "--ok-bd": "rgba(22, 163, 74, 0.26)",
  "--seta-select":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2354606e' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  colorScheme: "light",
};
