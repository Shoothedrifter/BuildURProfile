import type { DesignConfigV4, ResumeDisplayItem, ResumeModuleKindV2, StructuredResumeV3 } from "../../../../packages/contracts/src/config";
import { resumeDisplayContent, resumeItemHasContent, validHttpUrl } from "../../../../packages/contracts/src/resume-v2.mjs";

type OrderedItem = ResumeDisplayItem & { order: number };
type OrderedSection = StructuredResumeV3["sections"][number];
export type CyberProject = Readonly<{
  item: OrderedItem;
  index: number;
  images: ResumeDisplayItem["supplement"]["images"];
  layout: "text" | "single" | "double" | "mosaic";
  link?: { label: string; url: string };
}>;
export type CyberPresentation = Readonly<{
  profile: DesignConfigV4["content"]["profile"];
  sections: readonly (Omit<OrderedSection, "items"> & { kind: ResumeModuleKindV2; items: readonly OrderedItem[] })[];
  projects: readonly CyberProject[];
}>;

/** Keep the confirmed v3 tree as the only source of text, order, links and image IDs. */
export function buildCyberCreatorPresentation(config: DesignConfigV4): CyberPresentation {
  const resume = config.content.resume;
  const sections = [...resume.sections].sort((a, b) => a.order - b.order)
    .map(section => ({ ...section, items: [...section.items].sort((a, b) => a.order - b.order).filter(resumeItemHasContent) }))
    .filter(section => section.items.length > 0);
  const projects = sections.filter(section => section.kind === "projects").flatMap(section => section.items)
    .map((item, index): CyberProject => {
      const images = item.supplement.images;
      const layout = images.length === 0 ? "text" : images.length === 1 ? "single" : images.length === 2 ? "double" : "mosaic";
      const link = item.supplement.links.find(candidate => validHttpUrl(candidate.url));
      return { item, index: index + 1, images, layout, ...(link ? { link } : {}) };
    });
  return {
    profile: resumeDisplayContent(resume).profile,
    sections,
    projects
  };
}
