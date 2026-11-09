import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderChrome } from "./BuilderChrome";

it("shows the product logo in the nav and the footer", () => {
  render(<BuilderChrome projectCount={0} onHome={() => {}} onProjects={() => {}}
    onSample={() => {}} onSection={() => {}}>
    <p>content</p>
  </BuilderChrome>);
  const logos = screen.getAllByRole("img", { name: "BuildURProfile" });
  expect(logos).toHaveLength(2);
  logos.forEach((logo) => expect(logo).toHaveAttribute("src", "/logo.png"));
});
