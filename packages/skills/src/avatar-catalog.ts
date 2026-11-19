import type { TemplateId } from "../../contracts/src/config";

/** New portrait generation has one fixed style per supported website template. */
export const AVATAR_STYLES = [
  { id: "lofi-print-anime", label: "低清晰印刷感动漫", description: "粉绿霓虹 · 网点套印头像", hint: "低清动漫 / 网点套印" }
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];
export const DEFAULT_AVATAR_STYLE_ID: AvatarStyleId = "lofi-print-anime";
export const TEMPLATE_PORTRAIT_POLICIES: Partial<Record<TemplateId, Readonly<{
  pipelineId: "avatar.wibi.v1";
  styleId: AvatarStyleId;
}>>> = {
  "cyber-creator-v1": { pipelineId: "avatar.wibi.v1", styleId: "lofi-print-anime" }
};

/** Existing queued jobs may still refer to the retired recipe. This is not a new-generation choice. */
export const COMPATIBLE_AVATAR_RECIPE_IDS = ["retro-flat-anime-head", "lofi-print-anime"] as const;
