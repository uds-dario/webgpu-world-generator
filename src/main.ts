import {
  AmbientLight,
  Color,
  DirectionalLight,
  InstancedMesh,
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

ui.subscribe(() => {
  refreshTerrain();
  refreshGrassDensity();
});

setupInput(canvas, camera, terrainMesh, ({ uv, buttons, ctrlKey }) => {
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

  applyBrush(heightfield, xIndex, yIndex, { ...brushConfig, mode });
  refreshTerrain();
  refreshGrassDensity();

  const height = heightfield.getHeight(xIndex, yIndex);
  console.log(
    `Pick -> x: ${xIndex}, y: ${yIndex}, height: ${height.toFixed(3)}, mode: ${mode}`,
  );
});

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
  const elapsed = (now - startTime) * 0.001;

  const uiState = ui.getState();
  updateGrassWind(elapsed, {
    windStrength: uiState.windStrength,
    windFrequency: uiState.windFrequency,
    gustStrength: uiState.gustStrength,
    grassVariation: uiState.grassVariation,
  });

  if (grassLodContext && grassLodContext.patches.length > 0) {
    // TODO: usare GrassLodContext per LOD per patch (es. ridurre contributo delle patch lontane).
    // Per ora nessun cambiamento a grassMesh.count.
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener("resize", resize);

async function start() {
  await renderer.init();
  resize();
  requestAnimationFrame(render);
}

start().catch((error) => {
  console.error("Failed to initialize renderer", error);
});
