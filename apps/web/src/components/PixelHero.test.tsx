import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PixelTemplatePreview } from "./PixelHero";

it("uses the real pixel hero and full portrait stage in the template preview", () => {
  const { container } = render(<PixelTemplatePreview name="合成用户" role="开发者" intro="简短介绍" />);
  expect(container.querySelector(".pixel-world .pixel-hero .pixel-stage .pixel-portrait"))
    .toHaveAttribute("src", "/pixel-world-base.svg");
  expect(screen.getByRole("heading", { name: "合成用户" })).toBeInTheDocument();
  expect(screen.getByText("简短介绍")).toBeInTheDocument();
  expect(container.querySelector(".proof-snapshot-avatar")).toBeNull();
  expect(screen.queryByText("精选项目")).toBeNull();
});
