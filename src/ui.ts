export type UiState = {
  brushRadius: number;
  brushIntensity: number;
  brushMode: "raise" | "lower" | "smooth";
  heightLow: number;
  heightHigh: number;
  slopeThreshold: number;
  toolMode: "sculpt" | "tree-paint";
  treeDensity: number;
  windStrength: number;
  windFrequency: number;
  gustStrength: number;
  grassVariation: number;
  maxGrassInstances: number;
};

let state: UiState | null = null;
const listeners = new Set<() => void>();

export function setupUI() {
  state = {
    brushRadius: getNumber("brush-radius", 10),
    brushIntensity: getNumber("brush-intensity", 0.12),
    brushMode: "raise",
    heightLow: getNumber("height-low", -1),
    heightHigh: getNumber("height-high", 4),
    slopeThreshold: getNumber("slope-threshold", 0.35),
    toolMode: "sculpt",
    treeDensity: getNumber("tree-density", 0.6),
    windStrength: getNumber("wind-strength", 0.25),
    windFrequency: getNumber("wind-frequency", 1.5),
    gustStrength: getNumber("gust-strength", 0.35),
    grassVariation: getNumber("grass-variation", 1),
    maxGrassInstances: getNumber("max-grass-instances", 400000),
  };

  const notify = () => listeners.forEach((fn) => fn());

  wireInput("brush-radius", (v) => {
    if (!state) return;
    state.brushRadius = v;
    notify();
  });
  wireInput("brush-intensity", (v) => {
    if (!state) return;
    state.brushIntensity = v;
    notify();
  });
  wireInput("height-low", (v) => {
    if (!state) return;
    state.heightLow = v;
    notify();
  });
  wireInput("height-high", (v) => {
    if (!state) return;
    state.heightHigh = v;
    notify();
  });
  wireInput("slope-threshold", (v) => {
    if (!state) return;
    state.slopeThreshold = v;
    notify();
  });
  wireInput("wind-strength", (v) => {
    if (!state) return;
    state.windStrength = v;
    notify();
  });
  wireInput("wind-frequency", (v) => {
    if (!state) return;
    state.windFrequency = v;
    notify();
  });
  wireInput("gust-strength", (v) => {
    if (!state) return;
    state.gustStrength = v;
    notify();
  });
  wireInput("grass-variation", (v) => {
    if (!state) return;
    state.grassVariation = v;
    notify();
  });
  wireInput("max-grass-instances", (v) => {
    if (!state) return;
    state.maxGrassInstances = v;
    notify();
  });

  return {
    getState,
    subscribe,
  };
}

export function getState(): UiState {
  if (!state) {
    throw new Error("UI state not initialized");
  }
  return { ...state };
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
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

function getNumber(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}
