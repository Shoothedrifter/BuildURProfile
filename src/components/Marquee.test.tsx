import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Marquee } from "./Marquee";

const props = {
  direction: "left" as const,
  speed: 40,
  bindToScroll: false,
  rows: 2,
  tileSize: 88,
  pauseOnHover: true,
  items: ["Visual systems", "Creative code"]
};

describe("Marquee", () => {
  it("renders the requested rows and changes travel duration when speed changes", () => {
    const { rerender } = render(<Marquee {...props} />);
    const track = screen.getByTestId("marquee-track-0");
    const slowDuration = parseFloat(track.style.getPropertyValue("--marquee-duration"));
    expect(screen.getAllByTestId(/marquee-row-/)).toHaveLength(2);
    expect(screen.getAllByText("Visual systems").length).toBeGreaterThan(1);

    rerender(<Marquee {...props} speed={80} />);
    const fastDuration = parseFloat(track.style.getPropertyValue("--marquee-duration"));
    expect(fastDuration).toBeLessThan(slowDuration);
  });

  it("honors hover pause and scroll binding", async () => {
    const { rerender } = render(<Marquee {...props} />);
    const row = screen.getByTestId("marquee-row-0");
    const track = screen.getByTestId("marquee-track-0");
    fireEvent.mouseEnter(row);
    expect(track.style.animationPlayState).toBe("paused");
    fireEvent.mouseLeave(row);
    expect(track.style.animationPlayState).toBe("running");

    rerender(<Marquee {...props} bindToScroll direction="right" />);
    const initialTransform = track.style.transform;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 140 });
    fireEvent.scroll(window);
    await waitFor(() => expect(track.style.transform).not.toBe(initialTransform));
    expect(track.style.transform).toContain("translate3d(");
    expect(track.style.animationName).toBe("none");
  });

  it("freezes scroll-bound position while hovered and resumes from the current scroll after leave", async () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    render(<Marquee {...props} bindToScroll />);
    const row = screen.getByTestId("marquee-row-0");
    const track = screen.getByTestId("marquee-track-0");
    const before = track.style.transform;
    fireEvent.mouseEnter(row);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 250 });
    fireEvent.scroll(window);
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(track.style.transform).toBe(before);
    fireEvent.mouseLeave(row);
    fireEvent.scroll(window);
    await waitFor(() => expect(track.style.transform).not.toBe(before));
  });

  it("renders safely when there are no items", () => {
    render(<Marquee {...props} items={[]} />);
    expect(screen.queryByTestId("marquee-track-0")).not.toBeInTheDocument();
  });

  it("renders image items with their labels as alt text beside text items", () => {
    const image = "data:image/png;base64,AAAA";
    render(<Marquee {...props} rows={1} items={["Creative code", { label: "Design systems", image }]} />);

    expect(screen.getAllByText("Creative code")).toHaveLength(2);
    const images = screen.getAllByAltText("Design systems");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", image);
    expect(images[0]).toHaveClass("marquee-tile-image");
    expect(images[0].closest(".marquee-tile")).toHaveClass("marquee-tile--image");
    const captions = screen.getAllByText("Design systems");
    expect(captions).toHaveLength(2);
    expect(captions[0]).toBeVisible();
    expect(captions[0]).toHaveClass("marquee-tile-label");
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });
});
