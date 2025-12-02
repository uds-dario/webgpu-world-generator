import {
  ClampToEdgeWrapping,
  DataTexture,
  Euler,
  BufferAttribute,
  FloatType,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
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

type GrassWindUniforms = {
  uTime: { value: number };
  uWindStrength: { value: number };
  uWindFrequency: { value: number };
  uWindNoiseScale: { value: number };
  uWindDirection: { value: Vector2 };
};

const windUniforms: GrassWindUniforms = {
  uTime: { value: 0 },
  uWindStrength: { value: 0.25 },
  uWindFrequency: { value: 1.5 },
  uWindNoiseScale: { value: 0.8 },
  uWindDirection: { value: new Vector2(1, 0).normalize() },
};

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

      let density = 0;
      if (
        h >= params.minHeight &&
        h <= params.maxHeight &&
        slope <= params.maxSlope
      ) {
        const slopeNormalized = Math.min(1, slope / maxSlope);
        const baseNoise =
          0.5 +
          0.25 * Math.sin(u * 37.2 + v * 91.7) +
          0.25 * Math.cos(u * 21.1 - v * 47.0);
        density = baseNoise * (1 - 0.5 * slopeNormalized);
        density = Math.min(1, Math.max(0, density));
      }

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
): InstancedMesh {
  const maxInstances = options.maxInstances ?? 50_000;
  const bladeHeight = 1;
  const bladeWidth = 0.08;
  const segmentsY = 4;

  const geometry = new PlaneGeometry(bladeWidth, bladeHeight, 1, segmentsY);
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

  const material = new MeshStandardMaterial({
    color: "#5bbf3a",
    metalness: 0.05,
    roughness: 0.9,
    map: null,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindFrequency = windUniforms.uWindFrequency;
    shader.uniforms.uWindNoiseScale = windUniforms.uWindNoiseScale;
    shader.uniforms.uWindDirection = windUniforms.uWindDirection;

    shader.vertexShader = `
    uniform float uTime;
    uniform float uWindStrength;
    uniform float uWindFrequency;
    uniform float uWindNoiseScale;
    uniform vec2 uWindDirection;
  ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
    #include <begin_vertex>
    vec2 windDir = normalize(uWindDirection);
    float wavePhase = dot(transformed.xz * uWindNoiseScale, windDir) * uWindFrequency + uTime;
    float wind = sin(wavePhase);

    float heightFactor = clamp(position.y, 0.0, 1.0);
    float bend = wind * uWindStrength * heightFactor;

    transformed.xz += windDir * bend;
    `,
    );
  };
  (material as MeshStandardMaterial & { colorSpace?: SRGBColorSpace }).colorSpace =
    SRGBColorSpace;

  const mesh = new InstancedMesh(geometry, material, maxInstances);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);
  const rotation = new Euler();
  const quaternion = new Quaternion();

  const worldWidth = heightfield.width - 1;
  const worldHeight = heightfield.height - 1;

  let instanceIndex = 0;
  for (let y = 0; y < density.height; y++) {
    for (let x = 0; x < density.width; x++) {
      if (instanceIndex >= maxInstances) break;

      const densityValue = density.data[y * density.width + x];
      if (densityValue <= 0) continue;

      const u = density.width > 0 ? (x + 0.5) / density.width : 0.5;
      const v = density.height > 0 ? (y + 0.5) / density.height : 0.5;

      const baseRand = pseudoRandom(x, y, 0.37);
      const maxPerTexel = 3;
      const expected = densityValue * maxPerTexel;
      const count =
        Math.floor(expected) + (baseRand < expected - Math.floor(expected) ? 1 : 0);

      for (let i = 0; i < count && instanceIndex < maxInstances; i++) {
        const localRand = pseudoRandom(x, y, i * 1.37 + baseRand);
        const jitterX = pseudoRandom(x, y, i * 2.11) - 0.5;
        const jitterZ = pseudoRandom(x, y, i * 3.73 + 1) - 0.5;
        const worldX = (u - 0.5) * worldWidth + jitterX * 0.4;
        const worldZ = (v - 0.5) * worldHeight + jitterZ * 0.4;
        const height = sampleHeight(heightfield, u, v) * options.heightScale;

        position.set(worldX, height, worldZ);
        const yaw = localRand * Math.PI * 2;
        const tiltX = (pseudoRandom(x, y, i * 5.13) - 0.5) * 0.2;
        const tiltZ = (pseudoRandom(x, y, i * 7.91) - 0.5) * 0.2;
        rotation.set(tiltX, yaw, tiltZ);

        const scaleY = 0.8 + localRand * 0.6;
        const scaleX = 0.6 + pseudoRandom(x, y, i * 9.31) * 0.5;
        scale.set(scaleX, scaleY, 1);

        quaternion.setFromEuler(rotation);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(instanceIndex, matrix);
        instanceIndex++;
      }
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function updateGrassWind(timeSeconds: number) {
  windUniforms.uTime.value = timeSeconds;
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

function pseudoRandom(x: number, y: number, seed: number) {
  return fract(Math.sin(x * 12.9898 + y * 78.233 + seed * 43758.5453) * 43758.5453);
}

function fract(value: number) {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
