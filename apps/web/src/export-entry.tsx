import { createRoot } from "react-dom/client";
import { ShowcasePage } from "./ShowcasePage";
import type { DesignConfig } from "../../../packages/contracts/src/config";

const root = document.getElementById("root");
const raw = document.getElementById("buildurprofile-config")?.textContent;
const imageData = document.getElementById("buildurprofile-images")?.textContent;
const images = imageData ? JSON.parse(imageData) as Record<string, string> : {};
const defaultPortrait = document.getElementById("buildurprofile-default-portrait")?.textContent;
if (root && raw) {
  const config = JSON.parse(raw) as DesignConfig;
  createRoot(root).render(<ShowcasePage config={config} resolveResumeImage={id => images[id] ?? ""}
    defaultPortraitUrl={defaultPortrait || undefined}
    staticDecorations />);
}
