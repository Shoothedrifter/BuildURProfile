import type { DesignConfig } from "../../../../packages/contracts/src/config";

/** Preserve rendered content while removing PDF extraction evidence from published artifacts. */
export function toPublishedConfig(config: DesignConfig): DesignConfig {
  const content = { ...config.content };
  delete content.sourceRefs;
  return { ...config, content };
}
