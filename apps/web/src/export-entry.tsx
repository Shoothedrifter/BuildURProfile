import { createRoot } from "react-dom/client";
import { ShowcasePage } from "./ShowcasePage";
import type { DesignConfig } from "../../../packages/contracts/src/config";

const root = document.getElementById("root");
const raw = document.getElementById("buildurprofile-config")?.textContent;
if (root && raw) createRoot(root).render(<ShowcasePage config={JSON.parse(raw) as DesignConfig} />);
