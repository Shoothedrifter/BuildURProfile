import { createRoot } from "react-dom/client";
import { ShowcasePage } from "../ShowcasePage";
import type { DesignConfig } from "../../types/config";
import "../styles.css";

const root = document.getElementById("root");
const configElement = document.getElementById("buildurprofile-config");

if (!root || !configElement?.textContent) {
  throw new Error("The exported showcase is missing its root or design config.");
}

const config = JSON.parse(configElement.textContent) as DesignConfig;
createRoot(root).render(<ShowcasePage config={config} />);
