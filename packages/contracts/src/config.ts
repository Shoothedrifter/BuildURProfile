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
