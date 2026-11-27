import { pixelGazeAssets } from "../assets/pixel-gaze-v1";

export type Point = Readonly<{ x: number; y: number }>;
export type EyeOffsets = readonly [Point, Point];
export type ImageRect = Readonly<{ left: number; top: number; width: number; height: number }>;
type Pixels = Readonly<{ data: Uint8ClampedArray; width: number; height: number }>;

// Each run contains a two-byte length followed by one four-byte RGBA pixel.
function decode(value: string): Uint8ClampedArray {
  const encoded = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  let size = 0;
  for (let index = 0; index < encoded.length; index += 6) {
    size += (encoded[index] * 256 + encoded[index + 1]) * 4;
  }
  const output = new Uint8ClampedArray(size);
  let offset = 0;
  for (let index = 0; index < encoded.length; index += 6) {
    const count = encoded[index] * 256 + encoded[index + 1];
    for (let pixel = 0; pixel < count; pixel++) {
      output.set(encoded.subarray(index + 2, index + 6), offset);
      offset += 4;
    }
  }
  return output;
}

export const eyePatchBounds = pixelGazeAssets.bounds;
const eyes = pixelGazeAssets.eyes.map(eye => ({ ...eye, sprite: decode(eye.sprite) }));
export const pixelEyeProfiles = pixelGazeAssets.profiles.map(profile => ({
  id: profile.id,
  original: decode(profile.original),
  plate: decode(profile.plate),
  foreground: decode(profile.foreground),
}));
export type PixelEyeProfile = typeof pixelEyeProfiles[number];
export const neutralGaze: EyeOffsets = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

export function matchPixelEyeProfile(source: Pixels): PixelEyeProfile | null {
  if (source.width !== 1254 || source.height !== 1254) return null;
  const bounds = eyePatchBounds;
  return pixelEyeProfiles.find(profile => {
    for (let y = 0; y < bounds.height; y++) {
      const row = ((bounds.y + y) * source.width + bounds.x) * 4;
      for (let x = 0; x < bounds.width * 4; x++) {
        if (source.data[row + x] !== profile.original[y * bounds.width * 4 + x]) return false;
      }
    }
    return true;
  }) ?? null;
}

/** Match the square portrait's object-fit: contain and object-position: bottom. */
export function portraitContentRect(rect: ImageRect): ImageRect {
  const size = Math.min(rect.width, rect.height);
  return {
    left: rect.left + (rect.width - size) / 2,
    top: rect.top + rect.height - size,
    width: size,
    height: size,
  };
}

function snap(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-limit, Math.min(limit, Math.round(value / 3) * 3)) || 0;
}

export function computePixelGaze(pointer: Point, imageRect: ImageRect): EyeOffsets {
  const rect = portraitContentRect(imageRect);
  if (rect.width <= 0 || ![pointer.x, pointer.y, rect.left, rect.top, rect.width].every(Number.isFinite)) {
    return neutralGaze;
  }
  const x = (pointer.x - rect.left) / rect.width * 1254;
  const y = (pointer.y - rect.top) / rect.height * 1254;
  const offsets = eyes.map(eye => ({
    x: snap((x - (eyePatchBounds.x + eye.x + eye.width / 2)) * 0.03, 12),
    y: snap((y - (eyePatchBounds.y + eye.y + eye.height / 2)) * 0.03, 6),
  }));
  return [offsets[0], offsets[1]];
}

export function renderPixelEyePatch(profile: PixelEyeProfile, offsets: EyeOffsets): Uint8ClampedArray {
  const output = profile.plate.slice();
  const bounds = eyePatchBounds;
  eyes.forEach((eye, index) => {
    const dx = snap(offsets[index].x, 12);
    const dy = snap(offsets[index].y, 6);
    for (let y = 0; y < eye.height; y++) {
      for (let x = 0; x < eye.width; x++) {
        const source = (y * eye.width + x) * 4;
        const target = ((eye.y + y + dy) * bounds.width + eye.x + x + dx) * 4;
        output.set(eye.sprite.subarray(source, source + 4), target);
      }
    }
  });
  for (let index = 0; index < output.length; index += 4) {
    if (profile.foreground[index + 3] === 255) {
      output.set(profile.foreground.subarray(index, index + 4), index);
    }
  }
  return output;
}

export function drawPixelGaze(context: CanvasRenderingContext2D, profile: PixelEyeProfile, offsets: EyeOffsets): void {
  const bounds = eyePatchBounds;
  const image = context.createImageData(bounds.width, bounds.height);
  image.data.set(renderPixelEyePatch(profile, offsets));
  context.putImageData(image, 0, 0);
}
