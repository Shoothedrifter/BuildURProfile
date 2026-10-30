import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createLocalImageProvider } from "./provider-local.mjs";

const portrait = {
  bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3AAAASUVORK5CYII=", "base64"),
  mime: "image/png"
};

test("local provider sends portrait first, one Wibi reference, and returns generated PNG", async () => {
  let inputPath;
  let promptPath;
  let outputPath;
  const provider = createLocalImageProvider({ command: process.execPath, run: async (_command, args, options) => {
    assert.deepEqual(args.slice(0, 5), ["--model", "mlx-community/flux2-klein-4b-8bit", "--base-model", "flux2-klein-4b", "--image-paths"]);
    inputPath = args[5];
    assert.deepEqual(readFileSync(inputPath), portrait.bytes);
    assert.equal(args[6], "/style/reference-01.jpg");
    assert.equal(args.includes("/style/reference-02.jpg"), false);
    promptPath = args[args.indexOf("--prompt-file") + 1];
    const prompt = readFileSync(promptPath, "utf8");
    assert.match(prompt, /crayon/);
    assert.ok(prompt.indexOf("childlike drawing") < prompt.indexOf("full crayon style rules"));
    assert.equal(args.includes("--quantize"), false);
    assert.equal(args.includes("--low-ram"), true);
    assert.equal(options.env.HF_HOME.includes("avatar-model-cache"), true);
    assert.equal(options.env.HF_HUB_DISABLE_XET, "1");
    outputPath = args[args.indexOf("--output") + 1];
    writeFileSync(outputPath, portrait.bytes);
  } });
  const result = await provider.edit({ portrait, recipe: {
    id: "crayon-flat-naive", localSummary: "childlike drawing", instructions: "full crayon style rules",
    referencePaths: ["/style/reference-01.jpg", "/style/reference-02.jpg"]
  } });
  assert.equal(result.mime, "image/png");
  assert.deepEqual(result.bytes, portrait.bytes);
  assert.equal(existsSync(inputPath), false);
  assert.equal(existsSync(promptPath), false);
  assert.equal(existsSync(outputPath), false);
});

test("local provider reports missing CLI clearly", async () => {
  const provider = createLocalImageProvider({ command: "/does-not-exist/mflux-generate-flux2-edit" });
  await assert.rejects(provider.edit({ portrait, recipe: { id: "retro-flat-anime-head", instructions: "style", referencePaths: [] } }),
    { code: "MFLUX_NOT_INSTALLED" });
});
