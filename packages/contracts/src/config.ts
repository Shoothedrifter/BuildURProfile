export type SkinId = "dark-tech" | "light-minimal" | "high-saturation";
export type PaletteTone = "cool" | "neutral" | "warm" | "vivid";
export type JobRole = "ui-ux-designer" | "frontend-creative-developer" | "brand-motion-copy";

/** Four continuous scores; PChoice preserves the four-way visual tone choice. */
export type StyleVector = Readonly<{
  E: number;
  K: number;
  P: number;
  S: number;
  PChoice: PaletteTone;
}>;

export type MarqueeItem = string | Readonly<{ label: string; image: string }>;

export type MarqueeConfig = Readonly<{
  direction: "left" | "right";
  speed: number;
  bindToScroll: boolean;
  rows: number;
  tileSize: number;
  pauseOnHover: boolean;
  items?: readonly MarqueeItem[];
}>;

export type ProjectCard = Readonly<{
  id: string;
  index: string;
  title: string;
  category: string;
  year: string;
  description: string;
  tags: readonly string[];
  visual: "mint" | "lilac" | "peach";
  image?: string;
  link?: string;
}>;

export type StackedCardsConfig = Readonly<{
  scaleStep: number;
  offsetStep: number;
  stickyTop: number;
  layout: "center" | "offset" | "fan";
  cardRadius: number;
  enableTilt: boolean;
  autoPlay: boolean;
}>;

/** Confirmed, source-free resume modules. Empty arrays mean the module has no display content. */
export type ResumeFact = Readonly<{ key: string; label: string; value: string }>;
export type ResumeEntry = Readonly<{ title: string; details: string; facts: readonly ResumeFact[] }>;
export type StructuredResumeV1 = Readonly<{
  version: "resume-v1";
  basicInfo: readonly ResumeFact[];
  jobIntent: readonly ResumeFact[];
  selfEvaluation: readonly ResumeEntry[];
  education: readonly ResumeEntry[];
  workExperience: readonly ResumeEntry[];
  projects: readonly ResumeEntry[];
  awards: readonly ResumeEntry[];
  campusExperience: readonly ResumeEntry[];
  skills: readonly ResumeEntry[];
  other: readonly ResumeEntry[];
}>;

export type ResumeModuleKindV2 = 'basicInfo' | 'jobIntent' | 'selfEvaluation' | 'education' | 'workExperience' | 'projects' | 'awards' | 'campusExperience' | 'skills' | 'other';
export type ResumeDisplayItem = ResumeEntry & Readonly<{ itemId: string; supplement: Readonly<{ text: string; links: readonly { label: string; url: string }[]; images: readonly { imageId: string; caption: string }[] }> }>;
export type StructuredResumeV2 = Readonly<{ version: 'resume-v2'; sections: readonly { kind: ResumeModuleKindV2; items: readonly ResumeDisplayItem[] }[] }>;

/** Three sections of mock resume content, held locally in config.json. */
export type ResumeContent = Readonly<{
  profile: Readonly<{
    name: string;
    role: string;
    location: string;
    availability: string;
    intro: string;
    summary: string;
    email: string;
  }>;
  expertise: Readonly<{
    eyebrow: string;
    headline: string;
    summary: string;
    skills: readonly string[];
    disciplines: readonly string[];
  }>;
  projects: readonly ProjectCard[];
  workExperience?: readonly string[];
  campusExperience?: readonly string[];
  education?: readonly string[];
  resume?: StructuredResumeV1 | StructuredResumeV2;
  sourceRefs?: Readonly<Record<string, Readonly<{ page: number; excerpt: string }>>>;
}>;

/** The JSON-controlled renderer contract. No React or executable code in it. */
export type DesignConfig = Readonly<{
  styleVector: StyleVector;
  skin: SkinId;
  marquee: MarqueeConfig;
  stackedCards: StackedCardsConfig;
  content: ResumeContent;
  /** Session-scoped local demo asset. Never sent to paid project APIs. */
  heroArtwork?: Readonly<{ assetUrl: string; styleId: string; alt: string }>;
}>;
