import type { DesignConfig } from "../../types/config";

async function inlineImage(source: string, label: string): Promise<string> {
  if (source.startsWith("data:image/")) return source;
  try {
    const url = new URL(source, window.location.href);
    if (!["http:", "https:", "blob:"].includes(url.protocol)) throw new Error("Unsupported image URL");
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("The response is not an image");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image conversion failed"));
      reader.onerror = () => reject(reader.error ?? new Error("Image conversion failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    throw new Error(`Could not embed the ${label} image for publication.`);
  }
}

/** Only confirmed content and embedded assets are sent for paid delivery; the PDF remains local. */
export async function inlineConfigImages(config: DesignConfig): Promise<DesignConfig> {
  const [projects, items] = await Promise.all([
    Promise.all(config.content.projects.map(async (project) => project.image
      ? { ...project, image: await inlineImage(project.image, `project “${project.title}”`) }
      : project)),
    config.marquee.items && Promise.all(config.marquee.items.map(async (item) => typeof item === "string"
      ? item
      : { ...item, image: await inlineImage(item.image, `marquee “${item.label}”`) }))
  ]);
  return {
    ...config,
    marquee: items ? { ...config.marquee, items } : config.marquee,
    content: { ...config.content, projects }
  };
}
