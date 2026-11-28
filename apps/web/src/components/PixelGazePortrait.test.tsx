import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PixelGazePortrait } from "./PixelGazePortrait";
import { eyePatchBounds, pixelEyeProfiles } from "../lib/pixelGaze";

const neutral={width:1254,height:1254,data:new Uint8ClampedArray(1254*1254*4)};
for(let y=0;y<eyePatchBounds.height;y++) neutral.data.set(pixelEyeProfiles[0].original.subarray(y*eyePatchBounds.width*4,(y+1)*eyePatchBounds.width*4),((y+eyePatchBounds.y)*1254+eyePatchBounds.x)*4);
afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(unknown=false) {
  const fine=Object.assign(new EventTarget(),{matches:true});
  const reduced=Object.assign(new EventTarget(),{matches:false});
  vi.stubGlobal("matchMedia",vi.fn((query: string)=>query.includes("reduced-motion") ? reduced : fine));
  const put=vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:vi.fn(),getImageData:()=>unknown?{...neutral,width:1}:neutral,createImageData:(w:number,h:number)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData:put} as unknown as CanvasRenderingContext2D);
  const frame=vi.spyOn(window,"requestAnimationFrame").mockReturnValue(123);
  const cancel=vi.spyOn(window,"cancelAnimationFrame");
  const ref=createRef<HTMLDivElement>();
  const view=render(<div ref={ref}><PixelGazePortrait src="/pixel-world-base.svg" alt="测试角色" interactionRef={ref}/></div>);
  const img=screen.getByRole("img");
  Object.defineProperties(img,{naturalWidth:{value:1254},naturalHeight:{value:1254}});
  vi.spyOn(img,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:1254,height:1254} as DOMRect);
  fireEvent.load(img);
  return {...view,img,frame,cancel,put,fine,reduced,target:ref.current!,canvas:view.container.querySelector("canvas")!};
}
it("keeps the eye canvas out of normal flow and hidden before tracking starts without external CSS",()=>{
  const ref=createRef<HTMLDivElement>();
  const view=render(<div ref={ref}><PixelGazePortrait src="/pixel-world-base.svg" alt="测试角色" interactionRef={ref} disabled/></div>);
  const canvas=view.container.querySelector("canvas")!;
  const style=getComputedStyle(canvas);
  expect(style.position).toBe("absolute");
  expect(style.visibility).toBe("hidden");
  expect(style.pointerEvents).toBe("none");
  expect(style.imageRendering).toBe("pixelated");
});
it("prepares an eye overlay without duplicating the accessible image",()=>{
 const v=setup();
 expect(v.canvas).toHaveAttribute("data-gaze","ready");
 expect(v.canvas).toHaveAttribute("aria-hidden","true");
 expect(screen.getAllByRole("img")).toHaveLength(1);
});
it("coalesces pointer movement and cancels frames on leave and unmount",()=>{
 const v=setup();
 fireEvent(v.target,new MouseEvent("pointermove",{clientX:1100,clientY:1000}));
 fireEvent(v.target,new MouseEvent("pointermove",{clientX:1000,clientY:1100}));
 expect(v.frame).toHaveBeenCalledTimes(1);
 fireEvent.pointerLeave(v.target);
 expect(v.cancel).toHaveBeenCalledWith(123);
 const calls=v.put.mock.calls.length;
 v.unmount();
 fireEvent(v.target,new MouseEvent("pointermove",{clientX:1100,clientY:1000}));
 expect(v.put).toHaveBeenCalledTimes(calls);
});
it("keeps unknown eye geometry static",()=>{
 const v=setup(true);
 expect(v.canvas).not.toHaveAttribute("data-gaze","ready");
 fireEvent(v.target,new MouseEvent("pointermove",{clientX:1100,clientY:1000}));
 expect(v.frame).not.toHaveBeenCalled();
});
it("returns to the static image on reduced motion and ignores touch",()=>{
 const v=setup();
 const event=new MouseEvent("pointermove",{clientX:1100,clientY:1000});
 Object.defineProperty(event,"pointerType",{value:"touch"});
 fireEvent(v.target,event);
 expect(v.frame).not.toHaveBeenCalled();
 v.rerender(<div><PixelGazePortrait src="/pixel-world-base.svg" alt="测试角色" interactionRef={{current:v.target}} disabled/></div>);
 expect(v.container.querySelector("canvas")).not.toHaveAttribute("data-gaze","ready");
});

function moveAndPaint(v: ReturnType<typeof setup>) {
  fireEvent(v.target,new MouseEvent("pointermove",{clientX:1100,clientY:1000}));
  const callback=v.frame.mock.calls.at(-1)![0];
  act(()=>callback(0));
}
it("stops scheduling when the target is unchanged after painting",()=>{
  const v=setup();
  moveAndPaint(v);
  const calls=v.put.mock.calls.length;
  fireEvent(v.target,new MouseEvent("pointermove",{clientX:1100,clientY:1000}));
  expect(v.frame).toHaveBeenCalledTimes(1);
  expect(v.put).toHaveBeenCalledTimes(calls);
});
it.each(["blur","scroll","resize"])("restores neutral on %s",event=>{
  const v=setup();
  moveAndPaint(v);
  fireEvent(window,new Event(event));
  expect(v.put.mock.calls.at(-1)![0].data).toEqual(pixelEyeProfiles[0].original);
});
it("reacts to reduced motion changes and resumes with neutral eyes",()=>{
  const v=setup(); moveAndPaint(v);
  v.reduced.matches=true;
  act(()=>v.reduced.dispatchEvent(new Event("change")));
  expect(v.canvas).not.toHaveAttribute("data-gaze","ready");
  v.reduced.matches=false;
  act(()=>v.reduced.dispatchEvent(new Event("change")));
  expect(v.canvas).toHaveAttribute("data-gaze","ready");
  expect(v.put.mock.calls.at(-1)![0].data).toEqual(pixelEyeProfiles[0].original);
});
it("never exposes a stale canvas after drawing fails and media retries",()=>{
  const v=setup(); moveAndPaint(v);
  v.put.mockImplementation(()=>{throw new Error("canvas unavailable");});
  fireEvent(window,new Event("blur"));
  expect(v.canvas).not.toHaveAttribute("data-gaze","ready");
  act(()=>v.fine.dispatchEvent(new Event("change")));
  fireEvent.load(v.img);
  expect(v.canvas).not.toHaveAttribute("data-gaze","ready");
  expect(v.canvas.style.visibility).toBe("hidden");
});
it("hides the old eyes until the replacement image is decoded",()=>{
  const v=setup(); moveAndPaint(v);
  v.rerender(<div><PixelGazePortrait src="/new.png" alt="新角色" interactionRef={{current:v.target}}/></div>);
  expect(v.container.querySelector("canvas")).not.toHaveAttribute("data-gaze","ready");
});

it("resets offscreen and disconnects observers",()=>{
  let intersect!: IntersectionObserverCallback;
  const disconnect=vi.fn();
  vi.stubGlobal("IntersectionObserver",class {
    constructor(callback: IntersectionObserverCallback) { intersect=callback; }
    observe() {} disconnect=disconnect;
  });
  const v=setup(); moveAndPaint(v);
  act(()=>intersect([{isIntersecting:false}] as IntersectionObserverEntry[],{} as IntersectionObserver));
  expect(v.canvas.style.visibility).toBe("hidden");
  expect(v.put.mock.calls.at(-1)![0].data).toEqual(pixelEyeProfiles[0].original);
  act(()=>intersect([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver));
  expect(v.canvas).toHaveAttribute("data-gaze","ready");
  v.unmount(); expect(disconnect).toHaveBeenCalledTimes(1);
});
it("hides the overlay while the document is hidden",()=>{
  const v=setup(); moveAndPaint(v);
  vi.spyOn(document,"hidden","get").mockReturnValue(true);
  fireEvent(document,new Event("visibilitychange"));
  expect(v.canvas.style.visibility).toBe("hidden");
  expect(v.put.mock.calls.at(-1)![0].data).toEqual(pixelEyeProfiles[0].original);
});
it("falls back when a new source cannot be read",()=>{
  const v=setup();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(()=>{throw new DOMException("tainted","SecurityError");});
  v.rerender(<div><PixelGazePortrait src="/other.png" alt="新角色" interactionRef={{current:v.target}}/></div>);
  fireEvent.load(v.img);
  expect(v.container.querySelector("canvas")).not.toHaveAttribute("data-gaze","ready");
  expect(screen.getByRole("img",{name:"新角色"})).toBeVisible();
});
