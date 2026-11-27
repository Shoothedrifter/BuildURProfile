import { describe, expect, it } from "vitest";
import { computePixelGaze, matchPixelEyeProfile, renderPixelEyePatch, pixelEyeProfiles, eyePatchBounds } from "./pixelGaze";

function fixture(profile = pixelEyeProfiles[0]) {
  const source = {width:1254, height:1254, data:new Uint8ClampedArray(1254*1254*4)};
  const b = eyePatchBounds;
  for (let y=0;y<b.height;y++) {
    source.data.set(profile.original.subarray(y*b.width*4,(y+1)*b.width*4), ((b.y+y)*1254+b.x)*4);
  }
  return source;
}

describe("pixel eye profiles", () => {
  it.each([0,1])("reconstructs neutral RGBA exactly for profile %i", index => {
    const profile = pixelEyeProfiles[index];
    const source = fixture(profile);
    expect(matchPixelEyeProfile(source)).toBe(profile);
    expect(renderPixelEyePatch(profile, [{x:0,y:0},{x:0,y:0}])).toEqual(profile.original);
  });
  it("rejects altered eyes and unknown dimensions", () => {
    const source = fixture();
    source.data[((eyePatchBounds.y+20)*1254+eyePatchBounds.x+20)*4] ^= 255;
    expect(matchPixelEyeProfile(source)).toBeNull();
    expect(matchPixelEyeProfile({...source,width:512})).toBeNull();
  });
  it.each([0,1])("moves both pupils while preserving occluding pixels for profile %i", index => {
    const profile = pixelEyeProfiles[index];
    const pixels=renderPixelEyePatch(profile,[{x:12,y:6},{x:12,y:6}]);
    expect(pixels).not.toEqual(profile.original);
    for(let i=0;i<profile.foreground.length;i+=4) {
      if(profile.foreground[i+3]===255) expect(pixels.slice(i,i+4)).toEqual(profile.foreground.slice(i,i+4));
    }
    expect(renderPixelEyePatch(profile,[{x:500,y:500},{x:500,y:500}])).toEqual(pixels);
  });
});

describe("two dimensional gaze", () => {
  const rect = {left:0,top:0,width:1254,height:1254};
  it("clamps diagonal movement and snaps to the pixel grid", () => {
    expect(computePixelGaze({x:10000,y:10000},rect)).toEqual([{x:12,y:6},{x:12,y:6}]);
    expect(computePixelGaze({x:-10000,y:-10000},rect)).toEqual([{x:-12,y:-6},{x:-12,y:-6}]);
  });
  it("uses each eye center and preserves direction under scaled contain layout", () => {
    const first=computePixelGaze({x:1000,y:1000},rect);
    expect(computePixelGaze({x:600,y:600},{left:100,top:100,width:627,height:627})).toEqual(first);
    expect(computePixelGaze({x:639,y:568},rect)).toEqual([{x:3,y:0},{x:-3,y:0}]);
    expect(computePixelGaze({x:639,y:568},{left:0,top:-1254,width:1254,height:2508})).toEqual([{x:3,y:0},{x:-3,y:0}]);
  });
  it("returns neutral for missing or invalid geometry", () => {
    expect(computePixelGaze({x:1,y:1},{...rect,width:0})).toEqual([{x:0,y:0},{x:0,y:0}]);
    expect(computePixelGaze({x:NaN,y:1},rect)).toEqual([{x:0,y:0},{x:0,y:0}]);
  });
});
