import * as THREE from "three";
import { createScene } from "./scene";
import { Heightfield } from "./heightfield";
import {
  createGrassDensityMap,
  GrassDensityMap,
  createGrassInstancedMesh,
} from "./grass";
import {
  createTerrain,
  updateTerrainGeometryFromHeightfield,
  updateTerrainVertexColors,
} from "./terrain";
import { setupInput } from "./input";
import { applyBrush, SculptBrushConfig } from "./sculpt";
import { setupUI } from "./ui";

const canvas = document.getElementById("gfx") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Canvas #gfx non trovato");
}

const { scene, camera, renderer, controls } = createScene(canvas);
const ui = setupUI();

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
let grassMesh: THREE.InstancedMesh | null = null;
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
  grassMesh = createGrassInstancedMesh(heightfield, grassDensity, {
    heightScale,
    maxInstances: 50000,
  });
  scene.add(grassMesh);
}

function clampIndex(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function render() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener("resize", resize);
resize();
render();
