import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderChrome, WorkflowProgress } from "./BuilderChrome";

it("shows the product logo in the nav and the footer", () => {
  render(<BuilderChrome projectCount={0} onHome={() => {}} onProjects={() => {}}
    onSample={() => {}} onSection={() => {}}>
    <p>content</p>
  </BuilderChrome>);
  const logos = screen.getAllByRole("img", { name: "BuildURProfile" });
  expect(logos).toHaveLength(2);
  logos.forEach((logo) => expect(logo).toHaveAttribute("src", "/logo.png"));
});

it("按产品设计呈现四步流程，分享与付费并入生成完成", () => {
  render(<WorkflowProgress phase="delivery" />);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent))
    .toEqual(["1 上传简历", "2 解析与补充", "3 挑选风格", "4 生成完成"]);
  expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("生成完成");
});

it("landing 与 mock 阶段不点亮任何流程步骤", () => {
  const view = render(<WorkflowProgress phase="landing" />);
  expect(screen.queryByRole("listitem", { current: "step" })).not.toBeInTheDocument();
  view.unmount();
  render(<WorkflowProgress phase="mock" />);
  expect(screen.queryByRole("listitem", { current: "step" })).not.toBeInTheDocument();
});
