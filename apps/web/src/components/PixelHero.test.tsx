import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PixelHero, PixelTemplatePreview } from "./PixelHero";

it("uses the real pixel hero and full portrait stage in the template preview", () => {
  const { container } = render(<PixelTemplatePreview name="合成用户" role="开发者" intro="简短介绍" />);
  expect(container.querySelector(".pixel-world .pixel-hero .pixel-stage .pixel-portrait"))
    .toHaveAttribute("src", "/pixel-world-base.svg");
  expect(screen.getByRole("heading", { name: "合成用户" })).toBeInTheDocument();
  expect(screen.getByText("简短介绍")).toBeInTheDocument();
  expect(container.querySelector(".proof-snapshot-avatar")).toBeNull();
  expect(screen.queryByText("精选项目")).toBeNull();
});

it("uses the gaze layer for personal portraits and retains a default fallback", () => {
  const view=render(<PixelHero name="合成用户" role="" intro="" defaultPortraitUrl="data:image/svg+xml,test"
    artwork={{assetUrl:"/api/hero-assets/12345678-1234-1234-1234-123456789012",styleId:"pixel-halfbody-v1",alt:"个人像素头像"}}/>);
  expect(view.container.querySelector("canvas.pixel-gaze-overlay")).toBeInTheDocument();
  expect(screen.getByRole("img",{name:"个人像素头像"})).toBeInTheDocument();
});
