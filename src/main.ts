import {
  AmbientLight,
  Color,
  DirectionalLight,
  InstancedMesh,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WebGPURenderer } from "three/webgpu";
import { Heightfield } from "./heightfield";
import {
  createGrassDensityMap,
  GrassDensityMap,
  createGrassInstancedMesh,
  updateGrassWind,
  GrassLodContext,
} from "./grass";
import {
  createTerrain,
  updateTerrainGeometryFromHeightfield,
  updateTerrainVertexColors,
} from "./terrain";
import { setupInput } from "./input";
import { applyBrush, SculptBrushConfig } from "./sculpt";
import * as ui from "./ui";

const canvas = document.querySelector<HTMLCanvasElement>("#gfx");
if (!canvas) {
  throw new Error("Canvas #gfx non trovato");
}

if (!("gpu" in navigator)) {
  const message =
    "WebGPU non è supportato da questo browser / device. " +
    "Per eseguire questo progetto è necessario un browser con WebGPU abilitato (es. Chrome/Edge aggiornati su GPU compatibile).";
  console.error(message);
  alert(message);
  throw new Error("WebGPU not available");
}

const scene = new Scene();
scene.background = new Color(0x20252b);

const camera = new PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 10, 20);

const renderer = new WebGPURenderer({
  canvas,
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(new Color(0x000000));

const ambientLight = new AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
ui.setupUI();

const brushIndicator = createBrushIndicator();
scene.add(brushIndicator);

const fpsDisplay = document.getElementById("fps-counter");
let fpsWindowStart = performance.now();
let fpsFrameCount = 0;

const brushConfig: SculptBrushConfig = {
  radius: 10,
  intensity: 0.12,
  mode: "raise",
};

let ctrlActive = false;
window.addEventListener("keydown", (event) => {
  if (event.key === "Control") {
    ctrlActive = true;
    controls.enabled = false;
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Control") {
    ctrlActive = false;
    controls.enabled = true;
  }
});

window.addEventListener("blur", () => {
  ctrlActive = false;
  controls.enabled = true;
});

const heightfield = new Heightfield(256, 256, {
  useSimpleNoise: true,
  noiseAmplitude: 1.2,
  noiseFrequency: 0.08,
});

const heightScale = 2.5;
const terrainMesh = createTerrain(heightfield, heightScale);
let grassDensity: GrassDensityMap | null = null;
let grassMesh: InstancedMesh | null = null;
let grassLodContext: GrassLodContext | null = null;
scene.add(terrainMesh);
refreshTerrain();
refreshGrassDensity();

let isSculpting = false;
let grassUpdatePending = false;
let pausedWindDurationMs = 0;
let windPauseStart: number | null = null;

ui.subscribe(() => {
  refreshTerrain();
  refreshGrassDensity();
});

setupInput(canvas, camera, terrainMesh, ({ uv, buttons, ctrlKey }) => {
  updateBrushIndicator(uv);

  // Sculpt only when CTRL is held with a mouse button.
  if (!ctrlKey && !ctrlActive) return;
  const isPrimary = (buttons & 1) !== 0;
  const isSecondary = (buttons & 2) !== 0;
  if (!isPrimary && !isSecondary) return;

  // Map uv (0..1) to heightfield grid indices; clamp edges to avoid overflow.
  const xIndex = clampIndex(
    Math.floor(uv.x * (heightfield.width - 1)),
    0,
    heightfield.width - 1,
  );
  // V is flipped: uv.y=0 is top; heightfield y=0 is top, so invert to map correctly.
  const yIndex = clampIndex(
    Math.floor((1 - uv.y) * (heightfield.height - 1)),
    0,
    heightfield.height - 1,
  );

  const uiState = ui.getState();
  brushConfig.radius = uiState.brushRadius;
  brushConfig.intensity = uiState.brushIntensity;
  let mode: SculptBrushConfig["mode"] = uiState.brushMode;
  if (mode !== "smooth") {
    mode = isSecondary ? "lower" : "raise";
  }

  if (!isSculpting) {
    isSculpting = true;
    grassUpdatePending = false;
    windPauseStart = performance.now();
  }

  applyBrush(heightfield, xIndex, yIndex, { ...brushConfig, mode });
  refreshTerrain();
  grassUpdatePending = true;

  const height = heightfield.getHeight(xIndex, yIndex);
  console.log(
    `Pick -> x: ${xIndex}, y: ${yIndex}, height: ${height.toFixed(3)}, mode: ${mode}`,
  );
});

const endSculpting = () => {
  if (!isSculpting) return;
  isSculpting = false;
  if (windPauseStart !== null) {
    pausedWindDurationMs += performance.now() - windPauseStart;
    windPauseStart = null;
  }
  if (grassUpdatePending) {
    refreshGrassDensity();
    grassUpdatePending = false;
  }
};

window.addEventListener("mouseup", endSculpting);
window.addEventListener("blur", endSculpting);

function refreshTerrain() {
  updateTerrainGeometryFromHeightfield(
    terrainMesh.geometry,
    heightfield,
    heightScale,
  );
  const uiState = ui.getState();
  updateTerrainVertexColors(terrainMesh.geometry, heightfield, {
    heightLow: uiState.heightLow,
    heightHigh: uiState.heightHigh,
    slopeThreshold: uiState.slopeThreshold,
  });
}

function refreshGrassDensity() {
  const uiState = ui.getState();
  grassDensity = createGrassDensityMap(heightfield, {
    minHeight: uiState.heightLow,
    maxHeight: uiState.heightHigh,
    maxSlope: uiState.slopeThreshold,
    // Increase density resolution to allow reaching high instance counts (e.g. 400k)
    resolution: Math.max(heightfield.width, heightfield.height) * 2,
  });
  console.log("Grass density map rebuilt", {
    width: grassDensity.width,
    height: grassDensity.height,
  });
  rebuildGrassMesh();
}

function rebuildGrassMesh() {
  if (!grassDensity) return;
  if (grassMesh) {
    scene.remove(grassMesh);
    grassMesh.geometry.dispose();
    grassMesh.material.dispose();
  }
  grassLodContext = null;
  const uiState = ui.getState();
  const result = createGrassInstancedMesh(heightfield, grassDensity, {
    heightScale,
    maxInstances: uiState.maxGrassInstances,
  });
  grassMesh = result.mesh;
  grassLodContext = result.lod;
  scene.add(grassMesh);
}

function clampIndex(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

let startTime = performance.now();

function render(now: number) {
  if (fpsDisplay) {
    fpsFrameCount++;
    const elapsed = now - fpsWindowStart;
    if (elapsed >= 500) {
      const fps = (fpsFrameCount / elapsed) * 1000;
      fpsDisplay.textContent = `FPS: ${fps.toFixed(1)}`;
      fpsFrameCount = 0;
      fpsWindowStart = now;
    }
  }

  const pausedTime =
    pausedWindDurationMs +
    (isSculpting && windPauseStart !== null
      ? now - windPauseStart
      : 0);
  const windTime = (now - startTime - pausedTime) * 0.001;

  const uiState = ui.getState();
  if (!isSculpting) {
    updateGrassWind(windTime, {
      windStrength: uiState.windStrength,
      windFrequency: uiState.windFrequency,
      gustStrength: uiState.gustStrength,
      grassVariation: uiState.grassVariation,
    });
  }

  if (grassLodContext && grassLodContext.patches.length > 0) {
    // TODO: usare GrassLodContext per LOD per patch (es. ridurre contributo delle patch lontane).
    // Per ora nessun cambiamento a grassMesh.count.
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener("resize", resize);
canvas.addEventListener("mouseleave", () => {
  brushIndicator.visible = false;
});

async function start() {
  await renderer.init();
  resize();
  requestAnimationFrame(render);
}

start().catch((error) => {
  console.error("Failed to initialize renderer", error);
});

function createBrushIndicator(): Line {
  const segments = 64;
  const positions = new Float32Array(segments * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setDrawRange(0, segments);
  const material = new LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const line = new Line(geometry, material);
  line.visible = false;
  line.renderOrder = 2;
  return line;
}

function updateBrushIndicator(uv: { x: number; y: number }) {
  if (!brushIndicator) return;
  const uiState = ui.getState();
  const radius = uiState.brushRadius;
  const worldWidth = heightfield.width - 1;
  const worldHeight = heightfield.height - 1;
  const centerX = uv.x * worldWidth - worldWidth * 0.5;
  const centerZ = (1 - uv.y) * worldHeight - worldHeight * 0.5;
  const positionAttr = brushIndicator.geometry.getAttribute(
    "position",
  ) as BufferAttribute;
  const arr = positionAttr.array as Float32Array;
  const segments = arr.length / 3;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const px = centerX + Math.cos(angle) * radius;
    const pz = centerZ + Math.sin(angle) * radius;
    const ph = sampleHeightAtWorld(px, pz) * heightScale + 0.01;
    arr[i * 3] = px;
    arr[i * 3 + 1] = ph;
    arr[i * 3 + 2] = pz;
  }
  positionAttr.needsUpdate = true;
  brushIndicator.visible = true;
}

function sampleHeightAtWorld(worldX: number, worldZ: number): number {
  const worldWidth = heightfield.width - 1;
  const worldHeight = heightfield.height - 1;
  const u = worldWidth !== 0 ? worldX / worldWidth + 0.5 : 0.5;
  const v = worldHeight !== 0 ? worldZ / worldHeight + 0.5 : 0.5;
  const x = clamp(u, 0, 1) * (heightfield.width - 1);
  const y = clamp(v, 0, 1) * (heightfield.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(heightfield.width - 1, x0 + 1);
  const y1 = Math.min(heightfield.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const h00 = heightfield.getHeight(x0, y0);
  const h10 = heightfield.getHeight(x1, y0);
  const h01 = heightfield.getHeight(x0, y1);
  const h11 = heightfield.getHeight(x1, y1);
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - ty) + hx1 * ty;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
