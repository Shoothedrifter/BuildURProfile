import { useEffect, useRef, type RefObject } from "react";
import {
  computePixelGaze, drawPixelGaze, eyePatchBounds, matchPixelEyeProfile,
  neutralGaze, portraitContentRect, type EyeOffsets, type PixelEyeProfile,
} from "../lib/pixelGaze";

export function PixelGazePortrait({ src, alt, interactionRef, disabled = false, onError }: {
  src: string;
  alt: string;
  interactionRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  onError?: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    const hero = interactionRef.current;
    if (!image || !canvas || !hero || disabled || typeof window.matchMedia !== "function") return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let profile: PixelEyeProfile | null = null;
    let context: CanvasRenderingContext2D | null = null;
    let visible = true;
    let disposed = false;
    let frame: number | null = null;
    let target: EyeOffsets = neutralGaze;
    let previous = "";

    const hide = () => {
      canvas.style.visibility = "hidden";
      canvas.removeAttribute("data-gaze");
    };
    const allowed = () => fine.matches && !reduced.matches && !document.hidden && visible;
    const paint = (offsets: EyeOffsets) => {
      if (!context || !profile) return;
      const key = JSON.stringify(offsets);
      if (key === previous) return;
      try {
        drawPixelGaze(context, profile, offsets);
        previous = key;
      } catch {
        profile = null;
        hide();
      }
    };
    const reset = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      target = neutralGaze;
      paint(neutralGaze);
    };
    const layout = () => {
      reset();
      const bounds = portraitContentRect(image.getBoundingClientRect());
      const parent = image.parentElement?.getBoundingClientRect();
      if (!parent || parent.width <= 0 || parent.height <= 0) return;
      const patch = eyePatchBounds;
      Object.assign(canvas.style, {
        left: `${(bounds.left - parent.left + patch.x / 1254 * bounds.width) / parent.width * 100}%`,
        top: `${(bounds.top - parent.top + patch.y / 1254 * bounds.height) / parent.height * 100}%`,
        width: `${patch.width / 1254 * bounds.width / parent.width * 100}%`,
        height: `${patch.height / 1254 * bounds.height / parent.height * 100}%`,
      });
    };
    const load = () => {
      if (disposed || !allowed() || profile || image.naturalWidth !== 1254 || image.naturalHeight !== 1254) return;
      try {
        const scratch = document.createElement("canvas");
        scratch.width = 1254;
        scratch.height = 1254;
        const read = scratch.getContext("2d", { willReadFrequently: true });
        if (!read) return;
        read.drawImage(image, 0, 0);
        profile = matchPixelEyeProfile(read.getImageData(0, 0, 1254, 1254));
        scratch.width = 0;
        scratch.height = 0;
        if (!profile) return;
        context = canvas.getContext("2d");
        if (!context) {
          profile = null;
          return;
        }
        layout();
        previous = "";
        paint(neutralGaze);
        if (!profile) return;
        canvas.style.visibility = "visible";
        canvas.dataset.gaze = "ready";
      } catch {
        profile = null;
        hide();
      }
    };
    const media = () => {
      reset();
      if (!allowed()) {
        hide();
      } else if (profile) {
        canvas.style.visibility = "visible";
        canvas.dataset.gaze = "ready";
        layout();
      } else if (image.complete) {
        load();
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !allowed() || !profile) return;
      target = computePixelGaze({ x: event.clientX, y: event.clientY }, image.getBoundingClientRect());
      if (JSON.stringify(target) === previous || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!disposed && allowed()) paint(target);
      });
    };

    hide();
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("scroll", layout, true);
    window.addEventListener("resize", layout);
    document.addEventListener("visibilitychange", media);
    fine.addEventListener("change", media);
    reduced.addEventListener("change", media);
    image.addEventListener("load", load);
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(layout) : null;
    resize?.observe(image);
    const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      media();
    }) : null;
    intersection?.observe(hero);
    if (image.complete) load();

    return () => {
      disposed = true;
      reset();
      hide();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("scroll", layout, true);
      window.removeEventListener("resize", layout);
      document.removeEventListener("visibilitychange", media);
      fine.removeEventListener("change", media);
      reduced.removeEventListener("change", media);
      image.removeEventListener("load", load);
      resize?.disconnect();
      intersection?.disconnect();
    };
  }, [src, disabled, interactionRef]);

  return <>
    <img ref={imageRef} className="pixel-portrait" draggable={false} src={src} alt={alt}
      width="512" height="512" onError={onError} />
    <canvas ref={canvasRef} className="pixel-gaze-overlay" width={eyePatchBounds.width}
      height={eyePatchBounds.height} aria-hidden="true" />
  </>;
}
