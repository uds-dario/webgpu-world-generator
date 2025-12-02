export type HeightfieldOptions = {
  useSimpleNoise?: boolean;
  noiseAmplitude?: number;
  noiseFrequency?: number;
};

export class Heightfield {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;

  constructor(
    width: number,
    height: number,
    options: HeightfieldOptions = {},
  ) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height);

    if (options.useSimpleNoise) {
      this.fillWithSimpleNoise(
        options.noiseAmplitude ?? 1,
        options.noiseFrequency ?? 0.1,
      );
    }
  }

  getHeight(x: number, y: number): number {
    return this.data[this.index(x, y)];
  }

  setHeight(x: number, y: number, value: number): void {
    this.data[this.index(x, y)] = value;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private fillWithSimpleNoise(amplitude: number, frequency: number) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x * frequency;
        const ny = y * frequency;
        const h =
          Math.sin(nx) * 0.6 +
          Math.cos(ny * 0.8) * 0.4 +
          Math.sin(nx * 0.35 + ny * 0.15) * 0.8;
        this.setHeight(x, y, h * amplitude);
      }
    }
  }
}
