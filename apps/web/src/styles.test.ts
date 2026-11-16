import { afterEach, expect, it } from "vitest";
import "./styles.css";

afterEach(() => {
  document.body.replaceChildren();
});

it("keeps the legacy entry selector spaced and limits right alignment to Agent tools", () => {
  document.body.innerHTML = `
    <div class="proof-entry-top" data-testid="legacy-entry">
      <label><input type="checkbox" />用于展示</label>
      <span>PDF · 第 1 页</span>
    </div>
    <div class="proof-entry-top proof-entry-top--tools" data-testid="agent-tools">
      <div class="proof-entry-tools">条目工具</div>
    </div>`;

  const legacy = document.querySelector<HTMLElement>("[data-testid='legacy-entry']")!;
  const legacyLabel = legacy.querySelector<HTMLLabelElement>("label")!;
  const agentTools = document.querySelector<HTMLElement>("[data-testid='agent-tools']")!;

  expect(getComputedStyle(legacy).justifyContent).toBe("space-between");
  expect(getComputedStyle(legacyLabel).display).toBe("inline-flex");
  expect(getComputedStyle(legacyLabel).fontWeight).toBe("700");
  expect(getComputedStyle(agentTools).justifyContent).toBe("flex-end");
});
