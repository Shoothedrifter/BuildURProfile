/** Browser-memory parser output. It contains PDF excerpts and must never enter a generation brief. */
export type ResumeCandidateField = {
  value: string;
  source: string;
  page: number;
  included: boolean;
  experienceKind?: "campus";
  label?: string;
  fieldKey?: string;
};

export type ResumeCandidateV1 = {
  version: "resume-candidate-v1";
  name: ResumeCandidateField;
  email: ResumeCandidateField;
  basicInfo: ResumeCandidateField[];
  jobIntent: ResumeCandidateField[];
  selfEvaluation: ResumeCandidateField[];
  education: ResumeCandidateField[];
  workExperience: ResumeCandidateField[];
  projects: ResumeCandidateField[];
  awards: ResumeCandidateField[];
  skills: ResumeCandidateField[];
  other: ResumeCandidateField[];
};
