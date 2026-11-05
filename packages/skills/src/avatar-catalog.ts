/** Browser-safe, reviewed choices for the current portrait preview. */
export const AVATAR_STYLES = [
  { id: "retro-flat-anime-head", label: "复古扁平动画头", description: "90 年代动画特写 · 鲜明纯色背景", hint: "动画特写 / 纯色背景" },
  { id: "crayon-flat-naive", label: "蜡笔极简扁平画", description: "手绘蜡笔肌理 · 白纸背景", hint: "手绘蜡笔 / 白纸背景" },
  { id: "textile-toy-portrait", label: "颗粒绒感玩偶", description: "针织玩偶肖像 · 白底棚拍", hint: "纺织玩偶 / 白底棚拍" }
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];
