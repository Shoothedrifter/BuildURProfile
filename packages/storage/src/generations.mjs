import { createAssetStore } from "./generation/assets.mjs";
import { createGenerationQueue } from "./generation/queue.mjs";

export { cleanGenerationBrief } from "./generation/brief.mjs";

/** API/worker storage facade. Payment and graph modules depend on this port, not on each other. */
export function createGenerationService({ db, assetRoot = "data/avatar-assets", minPixels = 256, now = () => Date.now(),
  leaseMs = 90_000, maxAttempts = 3, retryBaseMs = 5_000, allowPortraits = true, requireBrief = false }) {
  const assets = createAssetStore({ db, assetRoot, minPixels, now, allowPortraits });
  const queue = createGenerationQueue({ db, assets, minPixels, now, leaseMs, maxAttempts, retryBaseMs,
    allowPortraits, requireBrief });
  return {
    savePortrait: assets.savePortrait,
    readAsset: assets.readAsset,
    readAssetForWorker: assets.readAssetForWorker,
    outputExists: assets.outputExists,
    purgeExpired: assets.purgeExpired,
    ...queue
  };
}
