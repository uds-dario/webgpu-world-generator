export type UiState = {
  brushRadius: number;
  brushIntensity: number;
  brushMode: "raise" | "lower" | "smooth";
  heightLow: number;
  heightHigh: number;
  slopeThreshold: number;
};

export function setupUI() {
  const state: UiState = {
    brushRadius: getNumber("brush-radius", 10),
    brushIntensity: getNumber("brush-intensity", 0.12),
    brushMode: getSelectValue("brush-mode", "raise") as UiState["brushMode"],
    heightLow: getNumber("height-low", -1),
    heightHigh: getNumber("height-high", 4),
    slopeThreshold: getNumber("slope-threshold", 0.35),
  };

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  wireInput("brush-radius", (v) => {
    state.brushRadius = v;
    notify();
  });
  wireInput("brush-intensity", (v) => {
    state.brushIntensity = v;
    notify();
  });
  wireSelect("brush-mode", (v) => {
    state.brushMode = v as UiState["brushMode"];
    notify();
  });
  wireInput("height-low", (v) => {
    state.heightLow = v;
    notify();
  });
  wireInput("height-high", (v) => {
    state.heightHigh = v;
    notify();
  });
  wireInput("slope-threshold", (v) => {
    state.slopeThreshold = v;
    notify();
  });

  return {
    getState: () => ({ ...state }),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function wireInput(id: string, onChange: (value: number) => void) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  const display = document.querySelector(
    `.value[data-for="${id}"]`,
  ) as HTMLElement | null;
  const handler = () => {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return;
    if (display) display.textContent = el.value;
    onChange(v);
  };
  el.addEventListener("input", handler);
  handler();
}

function wireSelect(id: string, onChange: (value: string) => void) {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (!el) return;
  const handler = () => onChange(el.value);
  el.addEventListener("change", handler);
  handler();
}

function getNumber(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

function getSelectValue(id: string, fallback: string): string {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (!el) return fallback;
  return el.value || fallback;
}
