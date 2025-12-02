import { Heightfield } from "./heightfield";

export type SculptBrushConfig = {
  radius: number;
  intensity: number;
  mode: "raise" | "lower" | "smooth";
};

export function applyBrush(
  heightfield: Heightfield,
  centerX: number,
  centerY: number,
  config: SculptBrushConfig,
): void {
  const { radius, intensity, mode } = config;
  const sourceData =
    mode === "smooth" ? new Float32Array(heightfield.data) : heightfield.data;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(heightfield.width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(heightfield.height - 1, Math.ceil(centerY + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const falloff = Math.max(0, 1 - dist / radius);
      if (mode === "smooth") {
        const oldHeight = sourceData[y * heightfield.width + x];
        const neighborAverage = getNeighborAverage(
          sourceData,
          heightfield.width,
          heightfield.height,
          x,
          y,
        );
        const smoothed = lerp(oldHeight, neighborAverage, falloff);
        heightfield.setHeight(x, y, smoothed);
      } else {
        const delta = intensity * falloff * (mode === "raise" ? 1 : -1);
        const nextHeight = heightfield.getHeight(x, y) + delta;
        heightfield.setHeight(x, y, nextHeight);
      }
    }
  }
}

function getNeighborAverage(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const kernel = 1; // 3x3 kernel around the current texel.
  let sum = 0;
  let count = 0;

  for (let ky = -kernel; ky <= kernel; ky++) {
    for (let kx = -kernel; kx <= kernel; kx++) {
      const nx = x + kx;
      const ny = y + ky;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      sum += data[ny * width + nx];
      count++;
    }
  }

  return count > 0 ? sum / count : data[y * width + x];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
