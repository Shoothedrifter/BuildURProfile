import type { PaletteTone, StyleVector } from "../../types/config";

export type AssessmentAxis = "E" | "K" | "P" | "S";
export type AssessmentOption = Readonly<{
  label: string;
  points: number;
  tone?: PaletteTone;
}>;
export type AssessmentQuestion = Readonly<{
  id: string;
  prompt: string;
  axis: AssessmentAxis;
  options: readonly AssessmentOption[];
}>;

const five = (labels: readonly [string, string, string, string, string]): readonly AssessmentOption[] =>
  labels.map((label, points) => ({ label, points }));

/** Eight fixed questions: two each for expression, kinetics, palette, and user control. */
export const QUESTIONS: readonly AssessmentQuestion[] = [
  {
    id: "e-presence", axis: "E", prompt: "你希望首页给人的第一印象是什么？",
    options: five(["安静克制", "柔和清晰", "平衡稳重", "鲜明有力", "大胆张扬"])
  },
  {
    id: "e-type", axis: "E", prompt: "标题和排版应该有多强的表现力？",
    options: five(["只需清楚易读", "少量视觉强调", "有重点的层次", "强烈的排版节奏", "成为页面主角"])
  },
  {
    id: "k-pace", axis: "K", prompt: "你偏好的页面运动节奏是？",
    options: five(["几乎静止", "缓慢轻微", "适中流畅", "明显活跃", "持续而强烈"])
  },
  {
    id: "k-cards", axis: "K", prompt: "切换作品卡片时，你想要多强的动感？",
    options: five(["直接切换", "短促过渡", "适度层次变化", "明显位移和缩放", "强烈的空间层次"])
  },
  {
    id: "p-tone", axis: "P", prompt: "你偏好的视觉基调是？",
    // Equal P points keep tone choice categorical. The next question sets continuous color strength.
    options: [
      { label: "冷色科技", points: 2, tone: "cool" },
      { label: "中性色", points: 2, tone: "neutral" },
      { label: "暖色柔和", points: 2, tone: "warm" },
      { label: "高彩鲜明", points: 2, tone: "vivid" }
    ]
  },
  {
    id: "p-strength", axis: "P", prompt: "你希望色彩有多强的存在感？",
    options: five(["非常收敛", "轻微点缀", "适度平衡", "比较醒目", "强烈主导"])
  },
  {
    id: "s-browse", axis: "S", prompt: "访客应该怎样浏览你的作品？",
    options: five(["按页面节奏自动观看", "大部分自动推进", "自动与手动并重", "主要由访客控制", "完全由访客探索"])
  },
  {
    id: "s-control", axis: "S", prompt: "你希望访客能控制多少页面动效？",
    options: five(["无需操作", "少量操作", "适度可控", "多数动效可操控", "交互由访客主导"])
  }
];

/** Answers are zero-based option indices keyed by question id. */
export function isAssessmentComplete(answers: Record<string, number>): boolean {
  return QUESTIONS.every(({ id, options }) =>
    Object.prototype.hasOwnProperty.call(answers, id)
    && Number.isInteger(answers[id])
    && answers[id] >= 0
    && answers[id] < options.length
  );
}

/** Sum selected points, then normalize each axis over its attainable min–max range. */
export function scoreAnswers(answers: Record<string, number>): StyleVector {
  if (!isAssessmentComplete(answers)) {
    throw new Error("Complete all eight questions with valid options before scoring.");
  }

  const totals: Record<AssessmentAxis, number> = { E: 0, K: 0, P: 0, S: 0 };
  const minimums: Record<AssessmentAxis, number> = { E: 0, K: 0, P: 0, S: 0 };
  const maximums: Record<AssessmentAxis, number> = { E: 0, K: 0, P: 0, S: 0 };
  let tone: PaletteTone | undefined;

  for (const question of QUESTIONS) {
    const selected = question.options[answers[question.id]];
    totals[question.axis] += selected.points;
    minimums[question.axis] += Math.min(...question.options.map((option) => option.points));
    maximums[question.axis] += Math.max(...question.options.map((option) => option.points));
    if (selected.tone) tone = selected.tone;
  }

  if (!tone) throw new Error("A palette tone is required.");
  const normalized = (axis: AssessmentAxis): number => {
    const range = maximums[axis] - minimums[axis];
    return range === 0 ? 0.5 : (totals[axis] - minimums[axis]) / range;
  };

  return { E: normalized("E"), K: normalized("K"), P: normalized("P"), S: normalized("S"), PChoice: tone };
}
