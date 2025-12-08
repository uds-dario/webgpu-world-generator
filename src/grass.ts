import {
  ClampToEdgeWrapping,
  DataTexture,
  Euler,
  BufferAttribute,
  FloatType,
  InstancedMesh,
  InstancedBufferAttribute,
  Matrix4,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  SRGBColorSpace,
  RepeatWrapping,
  TextureLoader,
  Vector2,
  Vector3,
  Color,
} from "three";
import { MeshStandardNodeMaterial, TSL } from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Heightfield } from "./heightfield";

export type GrassDensityMap = {
  width: number;
  height: number;
  data: Float32Array;
  texture: DataTexture;
};

export type GrassDensityParams = {
  minHeight: number;
  maxHeight: number;
  maxSlope: number;
  resolution?: number; // default: heightfield.width/height
};

export type GrassInstancingOptions = {
  heightScale: number;
  maxInstances?: number; // default: es. 50_000
};

export type GrassPatch = {
  center: Vector3;
  radius: number;
  startInstance: number;
  instanceCount: number;
};

export type GrassLodContext = {
  patches: GrassPatch[];
  maxInstances: number;
};

export type GrassInstanceResult = {
  mesh: InstancedMesh;
  lod: GrassLodContext;
};

export type GrassWindParams = {
  windStrength: number;
  windFrequency: number;
  gustStrength: number;
  grassVariation?: number;
};

const baseGrassColor = new Color("#5bbf3a");
const dryGrassColor = new Color("#c1b46a");
const { attribute, uniform, vec2, vec3, positionLocal, materialColor } = TSL;

const textureLoader = new TextureLoader();

const grassAlbedo = textureLoader.load("/textures/grass_albedo.jpg");
grassAlbedo.colorSpace = SRGBColorSpace;
grassAlbedo.wrapS = grassAlbedo.wrapT = RepeatWrapping;

const grassNormal = textureLoader.load("/textures/grass_normal.png");
grassNormal.wrapS = grassNormal.wrapT = RepeatWrapping;

const grassOrm = textureLoader.load("/textures/grass_orm.png");
grassOrm.wrapS = grassOrm.wrapT = RepeatWrapping;

const windUniforms = {
  uTime: uniform(0),
  uWindStrength: uniform(0.25),
  uWindFrequency: uniform(1.5),
  uWindNoiseScale: uniform(0.8),
  uWindDirection: uniform(new Vector2(1, 0).normalize()),
  uGustStrength: uniform(0.35),
  uGustFrequency: uniform(0.5),
  uGustNoiseScale: uniform(0.25),
  uGrassVariation: uniform(0.5),
  uMicroSwayStrength: uniform(0.08),
};

function createSingleBladeGeometry(): PlaneGeometry {
  const bladeHeight = 1;
  const bladeWidth = 0.08;
  const segmentsY = 4;
  const geometry = new PlaneGeometry(
    bladeWidth,
    bladeHeight,
    1,
    segmentsY,
  );
  geometry.translate(0, bladeHeight / 2, 0);
  geometry.rotateY(Math.PI);

  const pos = geometry.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = y / bladeHeight;
    const widthScale = 1 - 0.7 * t;
    const newX = x * widthScale;
    const bendAmount = 0.25;
    const bend = bendAmount * t * t;
    const newZ = z + bend;
    pos.setXYZ(i, newX, y, newZ);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function createGrassDensityMap(
  heightfield: Heightfield,
  params: GrassDensityParams,
): GrassDensityMap {
  const width = Math.max(
    1,
    Math.floor(params.resolution ?? heightfield.width),
  );
  const height = Math.max(
    1,
    Math.floor(params.resolution ?? heightfield.height),
  );
  const data = new Float32Array(width * height);

  const maxSlope = Math.max(params.maxSlope, 1e-5);
  const sampleStepU =
    heightfield.width > 1 ? 1 / (heightfield.width - 1) : 0.0;
  const sampleStepV =
    heightfield.height > 1 ? 1 / (heightfield.height - 1) : 0.0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = width > 1 ? x / (width - 1) : 0.5;
      const v = height > 1 ? y / (height - 1) : 0.5;

      const h = sampleHeight(heightfield, u, v);
      const slope = estimateSlope(
        heightfield,
        u,
        v,
        sampleStepU,
        sampleStepV,
      );

      const heightRange = params.maxHeight - params.minHeight;
      let heightMask = 0;
      if (heightRange > 0) {
        const t = (h - params.minHeight) / heightRange;
        const tClamped = Math.max(0, Math.min(1, t));
        heightMask = 1 - Math.abs(tClamped - 0.5) * 2;
        heightMask = Math.max(0, heightMask);
      } else {
        heightMask = 1;
      }

      const slopeT = slope / maxSlope;
      const slopeClamped = Math.max(0, Math.min(1, slopeT));
      let slopeMask = 1 - Math.max(0, slopeClamped - 0.6) / 0.4;
      slopeMask = Math.max(0, Math.min(1, slopeMask));

      const mask = heightMask * slopeMask;
      let density = 0;
      if (mask <= 0) {
        density = 0;
      } else {
        const n = pseudoNoise2D(u, v) * 0.7 + 0.3;

        // micro-noise per spezzare pattern di riga
        const microNoise =
          (pseudoNoise2D(u * 7.13 + 13.7, v * 9.17 + 3.1) - 0.5) * 0.2; // [-0.1, +0.1]

        const minBase = 0.35;
        let raw = n + microNoise;
        raw *= mask;
        density = minBase + (1 - minBase) * raw;
      }
      density = Math.max(0, Math.min(1, density));

      data[y * width + x] = density;
    }
  }

  const texture = new DataTexture(data, width, height, RedFormat, FloatType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;

  return { width, height, data, texture };
}

export function createGrassInstancedMesh(
  heightfield: Heightfield,
  density: GrassDensityMap,
  options: GrassInstancingOptions,
): GrassInstanceResult {
  const maxInstances = options.maxInstances ?? 50_000;
  const maxPerTexel = 6;

  // Compute expected total instances to scale uniformly when capped.
  let totalExpected = 0;
  for (let y = 0; y < density.height; y++) {
    for (let x = 0; x < density.width; x++) {
      const densityValue = density.data[y * density.width + x];
      if (densityValue <= 0) continue;
      totalExpected += densityValue * maxPerTexel;
    }
  }
  const scaleFactor =
    totalExpected > maxInstances && totalExpected > 0
      ? maxInstances / totalExpected
      : 1;

  const bladeGeometryA = createSingleBladeGeometry();
  const bladeGeometryB = createSingleBladeGeometry();
  bladeGeometryB.rotateY(Math.PI * 0.5);

  const crossGeometry = mergeGeometries(
    [bladeGeometryA, bladeGeometryB],
    false,
  )!;
  crossGeometry.computeVertexNormals();
  bladeGeometryA.dispose();
  bladeGeometryB.dispose();
  const geometry = crossGeometry;

  const instancePhaseOffsetAttr = attribute("instancePhaseOffset", "float");
  const instanceStiffnessAttr = attribute("instanceStiffness", "float");
  const instanceColorFactorAttr = attribute("instanceColorFactor", "float");
  const instanceHeightFactorAttr = attribute("instanceHeightFactor", "float");

  const windDir = windUniforms.uWindDirection.normalize();
  const gustDir = vec2(windDir.y.negate(), windDir.x);

  const heightMul = instanceHeightFactorAttr
    .mul(windUniforms.uGrassVariation)
    .mul(0.6)
    .add(0.7); // mix(0.7, 1.3, instanceHeightFactor * variation)

  const basePhase = positionLocal.xz
    .mul(windUniforms.uWindNoiseScale)
    .dot(windDir)
    .mul(windUniforms.uWindFrequency)
    .add(windUniforms.uTime)
    .add(instancePhaseOffsetAttr);
  const baseWind = basePhase.sin();

  const gustPhase = positionLocal.xz
    .mul(windUniforms.uGustNoiseScale)
    .dot(gustDir)
    .mul(windUniforms.uGustFrequency)
    .add(windUniforms.uTime.mul(0.5))
    .add(instancePhaseOffsetAttr.mul(0.5));
  const gustWind = gustPhase.sin();

  const macroWind = baseWind;

  const gustWindWeighted = gustWind.mul(windUniforms.uGustStrength);

  const microPhase = windUniforms.uTime
    .mul(2)
    .add(instancePhaseOffsetAttr.mul(4))
    .add(positionLocal.y.mul(3));
  const microWind = microPhase.sin().mul(windUniforms.uMicroSwayStrength);

  const combinedWind = macroWind.add(gustWindWeighted).add(microWind);
  const heightFactor = positionLocal.y.mul(heightMul).clamp(0, 1);
  const stiffnessFactor = instanceStiffnessAttr.mul(0.8).add(0.4);
  const bend = combinedWind
    .mul(windUniforms.uWindStrength)
    .mul(heightFactor)
    .mul(stiffnessFactor);

  const bendOffset = windDir.mul(bend);
  const displacedXZ = positionLocal.xz.add(bendOffset);
  const displacedPosition = vec3(displacedXZ.x, positionLocal.y.mul(heightMul), displacedXZ.y);

  const baseColorNode = materialColor.rgb;
  const dryColorNode = vec3(0.76, 0.71, 0.42);
  const lushColorNode = vec3(0.35, 0.8, 0.35);
  const variation = instanceColorFactorAttr
    .sub(0.5)
    .mul(2)
    .mul(windUniforms.uGrassVariation);
  const dryFactor = variation.max(0);
  const lushFactor = variation.min(0).negate();
  const colorAdjust = dryColorNode
    .sub(baseColorNode)
    .mul(dryFactor)
    .add(lushColorNode.sub(baseColorNode).mul(lushFactor));
  const finalColor = baseColorNode.add(colorAdjust);

  const material = new MeshStandardNodeMaterial({
    color: baseGrassColor,
    map: grassAlbedo,
    normalMap: grassNormal,
    roughnessMap: grassOrm,
    metalnessMap: grassOrm,
    roughness: 1.0,
    metalness: 0.0,
    alphaTest: 0.4,
    transparent: true,
  });
  material.positionNode = displacedPosition;
  material.colorNode = finalColor;
  material.normalScale.set(1, 1);
  (material as MeshStandardNodeMaterial & { colorSpace?: SRGBColorSpace }).colorSpace =
    SRGBColorSpace;

  const mesh = new InstancedMesh(geometry, material, maxInstances);
  const phaseArray = new Float32Array(maxInstances);
  const stiffnessArray = new Float32Array(maxInstances);
  const phaseAttr: InstancedBufferAttribute = new InstancedBufferAttribute(phaseArray, 1);
  const stiffnessAttr: InstancedBufferAttribute = new InstancedBufferAttribute(
    stiffnessArray,
    1,
  );
  const colorFactorArray = new Float32Array(maxInstances);
  const heightFactorArray = new Float32Array(maxInstances);
  const colorFactorAttr: InstancedBufferAttribute = new InstancedBufferAttribute(
    colorFactorArray,
    1,
  );
  const heightFactorAttr: InstancedBufferAttribute = new InstancedBufferAttribute(
    heightFactorArray,
    1,
  );
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);
  const rotation = new Euler();
  const quaternion = new Quaternion();

  const worldWidth = heightfield.width - 1;
  const worldHeight = heightfield.height - 1;

  const patchCountX = 16;
  const patchCountY = 16;
  const texelsPerPatchX = Math.ceil(density.width / patchCountX);
  const texelsPerPatchY = Math.ceil(density.height / patchCountY);

  const patches: GrassPatch[] = [];

  let instanceIndex = 0;

  for (let py = 0; py < patchCountY; py++) {
    const yStart = py * texelsPerPatchY;
    const yEnd = Math.min(density.height, yStart + texelsPerPatchY);

    for (let px = 0; px < patchCountX; px++) {
      const xStart = px * texelsPerPatchX;
      const xEnd = Math.min(density.width, xStart + texelsPerPatchX);

      const patchStart = instanceIndex;

      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let sampleCount = 0;

      for (let y = yStart; y < yEnd && instanceIndex < maxInstances; y++) {
        for (let x = xStart; x < xEnd && instanceIndex < maxInstances; x++) {
          const densityValue = density.data[y * density.width + x];
          if (densityValue <= 0) continue;

          // size di una cella in UV
          const cellUSize = density.width > 0 ? 1 / density.width : 1;
          const cellVSize = density.height > 0 ? 1 / density.height : 1;

          // UV del centro cella
          const baseU = density.width > 0 ? (x + 0.5) / density.width : 0.5;
          const baseV = density.height > 0 ? (y + 0.5) / density.height : 0.5;

          const baseRand = pseudoRandom(x, y, 0.37);
          const expected = densityValue * maxPerTexel;
          const scaledExpected = expected * scaleFactor;
          const baseCount = Math.floor(scaledExpected);
          const fractional = scaledExpected - baseCount;
          let count = baseCount + (baseRand < fractional ? 1 : 0);
          const remaining = maxInstances - instanceIndex;
          if (count > remaining) {
            count = remaining;
          }
          if (count <= 0) continue;

          for (let i = 0; i < count && instanceIndex < maxInstances; i++) {
            const localRand = pseudoRandom(x, y, i * 1.37 + baseRand);

            // jitter in UV dentro la cella: [-0.5,+0.5] texel
            const jitterU = (pseudoRandom(x, y, i * 2.11) - 0.5) * cellUSize;
            const jitterV = (pseudoRandom(x, y, i * 3.73 + 1) - 0.5) * cellVSize;

            const sampleU = clamp(baseU + jitterU, 0, 1);
            const sampleV = clamp(baseV + jitterV, 0, 1);

            // world pos derivata dagli UV jitterati
            const worldX = (sampleU - 0.5) * worldWidth;
            const worldZ = (sampleV - 0.5) * worldHeight;

            // altezza campionata nello stesso punto
            const height = sampleHeight(heightfield, sampleU, sampleV) * options.heightScale;

            position.set(worldX, height, worldZ);

            const yaw = localRand * Math.PI * 2;
            const tiltX = (pseudoRandom(x, y, i * 5.13) - 0.5) * 0.2;
            const tiltZ = (pseudoRandom(x, y, i * 7.91) - 0.5) * 0.2;
            rotation.set(tiltX, yaw, tiltZ);

            const variation = pseudoRandom(x, y, i * 9.31);
            const scaleY = 0.8 + localRand * 0.6;
            const scaleX = 0.4 + variation * 0.4;
            scale.set(scaleX, scaleY, 1);

            quaternion.setFromEuler(rotation);
            matrix.compose(position, quaternion, scale);

            phaseArray[instanceIndex] = baseRand * Math.PI * 2;
            stiffnessArray[instanceIndex] = Math.random();
            colorFactorArray[instanceIndex] = variation;
            heightFactorArray[instanceIndex] = variation;
            mesh.setMatrixAt(instanceIndex, matrix);

            sumX += worldX;
            sumY += height;
            sumZ += worldZ;
            sampleCount++;
            instanceIndex++;
          }
        }
      }

      const patchInstanceCount = instanceIndex - patchStart;
      if (patchInstanceCount > 0 && sampleCount > 0) {
        const center = new Vector3(
          sumX / sampleCount,
          sumY / sampleCount,
          sumZ / sampleCount,
        );
        const patchWidthWorld =
          ((xEnd - xStart) / Math.max(1, density.width)) * worldWidth;
        const patchHeightWorld =
          ((yEnd - yStart) / Math.max(1, density.height)) * worldHeight;
        const radius = Math.sqrt(
          (patchWidthWorld * patchWidthWorld +
            patchHeightWorld * patchHeightWorld) *
            0.25,
        );
        patches.push({
          center,
          radius,
          startInstance: patchStart,
          instanceCount: patchInstanceCount,
        });
      }
    }
  }

  geometry.setAttribute("instancePhaseOffset", phaseAttr);
  geometry.setAttribute("instanceStiffness", stiffnessAttr);
  geometry.setAttribute("instanceColorFactor", colorFactorAttr);
  geometry.setAttribute("instanceHeightFactor", heightFactorAttr);
  mesh.count = instanceIndex;
  mesh.instanceMatrix.needsUpdate = true;
  return {
    mesh,
    lod: {
      patches,
      maxInstances,
    },
  };
}

export function updateGrassWind(
  timeSeconds: number,
  params?: GrassWindParams,
) {
  windUniforms.uTime.value = timeSeconds;
  if (params) {
    windUniforms.uWindStrength.value = params.windStrength;
    windUniforms.uWindFrequency.value = params.windFrequency;
    windUniforms.uGustStrength.value = params.gustStrength;
    if (typeof params.grassVariation === "number") {
      windUniforms.uGrassVariation.value = params.grassVariation;
    }
  }
}

export function getGrassDensityAtUV(
  density: GrassDensityMap,
  u: number,
  v: number,
): number {
  const uu = clamp(u, 0, 1);
  const vv = clamp(v, 0, 1);
  const x =
    density.width > 1
      ? Math.round(uu * (density.width - 1))
      : 0;
  const y =
    density.height > 1
      ? Math.round(vv * (density.height - 1))
      : 0;
  const index = y * density.width + x;
  return density.data[index] ?? 0;
}

function sampleHeight(
  heightfield: Heightfield,
  u: number,
  v: number,
): number {
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

function estimateSlope(
  heightfield: Heightfield,
  u: number,
  v: number,
  du: number,
  dv: number,
): number {
  const hL = sampleHeight(heightfield, u - du, v);
  const hR = sampleHeight(heightfield, u + du, v);
  const hD = sampleHeight(heightfield, u, v - dv);
  const hU = sampleHeight(heightfield, u, v + dv);
  const dx = (hR - hL) * 0.5;
  const dy = (hU - hD) * 0.5;
  return Math.sqrt(dx * dx + dy * dy);
}

function pseudoNoise2D(u: number, v: number) {
  return (
    0.5 +
    0.25 * Math.sin(u * 37.2 + v * 91.7) +
    0.25 * Math.cos(u * 21.1 - v * 47.0)
  );
}

function pseudoRandom(x: number, y: number, seed: number) {
  return fract(Math.sin(x * 12.9898 + y * 78.233 + seed * 43758.5453) * 43758.5453);
}

function fract(value: number) {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
