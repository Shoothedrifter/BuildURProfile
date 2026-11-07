/** Browser-safe, reviewed choices for the current portrait preview. */
export const AVATAR_STYLES = [
  { id: "retro-flat-anime-head", label: "复古扁平动画头", description: "90 年代动画特写 · 鲜明纯色背景", hint: "动画特写 / 纯色背景" },
  { id: "yellow-hair-doodle", label: "明黄发丝涂鸦", description: "明黄背景 · 黑白发流与朱红涂鸦", hint: "明黄背景 / 发丝涂鸦" },
  { id: "lofi-print-anime", label: "低清晰印刷感动漫", description: "粉绿霓虹 · 网点套印头像", hint: "低清动漫 / 网点套印" }
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];
