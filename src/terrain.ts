import {
  BufferAttribute,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { Heightfield } from "./heightfield";

export function createTerrain(
  heightfield: Heightfield,
  heightScale = 1,
): Mesh {
  const widthSegments = heightfield.width - 1;
  const heightSegments = heightfield.height - 1;

  const geometry = new PlaneGeometry(
    heightfield.width - 1,
    heightfield.height - 1,
    widthSegments,
    heightSegments,
  );
  geometry.rotateX(-Math.PI / 2);

  updateTerrainGeometryFromHeightfield(geometry, heightfield, heightScale);

  const material = new MeshStandardMaterial({
    color: "#6b8e23",
    roughness: 0.9,
    metalness: 0.05,
    vertexColors: true,
  });

  return new Mesh(geometry, material);
}

export function updateTerrainGeometryFromHeightfield(
  geometry: PlaneGeometry,
  heightfield: Heightfield,
  heightScale: number,
): void {
  const position = geometry.getAttribute("position");
  const widthSegments = heightfield.width - 1;
  const heightSegments = heightfield.height - 1;
  const verticesPerRow = widthSegments + 1;

  // The PlaneGeometry is built with (widthSegments + 1) vertices per row.
  // Vertex index -> (col, row):
  //   row = floor(index / verticesPerRow)
  //   col = index % verticesPerRow
  for (let row = 0; row <= heightSegments; row++) {
    for (let col = 0; col <= widthSegments; col++) {
      const vertexIndex = row * verticesPerRow + col;
      const height = heightfield.getHeight(col, row);
      position.setY(vertexIndex, height * heightScale);
    }
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function updateTerrainVertexColors(
  geometry: PlaneGeometry,
  heightfield: Heightfield,
  params: { heightLow: number; heightHigh: number; slopeThreshold: number },
): void {
  const { heightLow, heightHigh, slopeThreshold } = params;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const vertexCount = position.count;

  let colorAttr = geometry.getAttribute("color") as BufferAttribute | null;
  if (!colorAttr || colorAttr.count !== vertexCount) {
    colorAttr = new BufferAttribute(new Float32Array(vertexCount * 3), 3);
    geometry.setAttribute("color", colorAttr);
  }

  const lowFlat = new Color("#3f4a2f");
  const mid = new Color("#6f8b4e");
  const high = new Color("#d9d9d9");
  const steep = new Color("#7d7d7d");

  const heightRange = Math.max(1e-5, heightHigh - heightLow);

  for (let i = 0; i < vertexCount; i++) {
    const worldHeight = position.getY(i);
    const hNorm = clamp01((worldHeight - heightLow) / heightRange);

    const slope = 1 - normal.getY(i); // 0 = flat up, 1 = vertical
    const steepWeight = clamp01(
      (slope - slopeThreshold) / Math.max(1e-5, 1 - slopeThreshold),
    );

    const flatColor = sampleHeightPalette(hNorm, lowFlat, mid, high);
    const finalColor = flatColor.clone().lerp(steep, steepWeight);

    colorAttr.setXYZ(i, finalColor.r, finalColor.g, finalColor.b);
  }

  colorAttr.needsUpdate = true;
  (geometry as unknown as { colorsNeedUpdate?: boolean }).colorsNeedUpdate =
    true;
}

function sampleHeightPalette(
  t: number,
  low: Color,
  mid: Color,
  high: Color,
): Color {
  if (t <= 0.5) {
    return new Color().lerpColors(low, mid, t * 2);
  }
  return new Color().lerpColors(mid, high, (t - 0.5) * 2);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
