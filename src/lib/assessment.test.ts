import { describe, expect, it } from "vitest";
import { QUESTIONS, isAssessmentComplete, scoreAnswers } from "./assessment";

const allFirst = (): Record<string, number> => Object.fromEntries(QUESTIONS.map((question) => [question.id, 0]));

describe("assessment", () => {
  it("has eight answerable questions, two for each dimension", () => {
    expect(QUESTIONS).toHaveLength(8);
    expect(QUESTIONS.map((question) => question.axis).sort()).toEqual(["E", "E", "K", "K", "P", "P", "S", "S"]);
    expect(new Set(QUESTIONS.map((question) => question.id)).size).toBe(8);
    expect(QUESTIONS.every((question) => question.options.length >= 4 && question.options.every((option) => option.label.length > 0))).toBe(true);
  });

  it("normalizes least and most expressive valid choices to the endpoints", () => {
    const low = allFirst();
    const high = Object.fromEntries(QUESTIONS.map((question) => [question.id, question.options.length - 1]));

    expect(isAssessmentComplete(low)).toBe(true);
    expect(isAssessmentComplete(high)).toBe(true);
    expect(scoreAnswers(low)).toEqual({ E: 0, K: 0, P: 0, S: 0, PChoice: "cool" });
    expect(scoreAnswers(high)).toEqual({ E: 1, K: 1, P: 1, S: 1, PChoice: "vivid" });
  });

  it("scores each dimension independently and retains the categorical tone", () => {
    const answers = {
      "e-presence": 4, "e-type": 0,
      "k-pace": 1, "k-cards": 3,
      "p-tone": 1, "p-strength": 2,
      "s-browse": 0, "s-control": 4
    };

    expect(scoreAnswers(answers)).toEqual({ E: 0.5, K: 0.5, P: 0.5, S: 0.5, PChoice: "neutral" });
    expect(answers).toEqual({
      "e-presence": 4, "e-type": 0, "k-pace": 1, "k-cards": 3,
      "p-tone": 1, "p-strength": 2, "s-browse": 0, "s-control": 4
    });
  });

  it("rejects missing, fractional, and out-of-range option indices", () => {
    const complete = allFirst();
    const missing = { ...complete };
    delete missing["k-cards"];

    for (const invalid of [missing, { ...complete, "k-cards": 1.5 }, { ...complete, "p-tone": 9 }]) {
      expect(isAssessmentComplete(invalid)).toBe(false);
      expect(() => scoreAnswers(invalid)).toThrow(/complete all eight questions/i);
    }
  });
});
