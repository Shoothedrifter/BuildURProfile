import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { templateToConfig } from "./mapping.ts";

const designConfigV4Schema = JSON.parse(readFileSync(
  new URL("../../contracts/schema/design-config.v4.json", import.meta.url), "utf8"));

/** 按 design-config.v4.json 的 HeroPhoto 定义检查单个 heroPhoto 值是否被合同接受。 */
function heroPhotoAccepted(value) {
  const def = designConfigV4Schema.$defs.HeroPhoto;
  if (!def) return false;
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return def.required.every((key) => keys.includes(key)) &&
    keys.every((key) => key in def.properties && def.properties[key].type === "string" && typeof value[key] === "string");
}

test("warm-macaron-v1 注册到模板映射且向量与 warm-v1 并存", () => {
  const config = templateToConfig("warm-macaron-v1", "ui-ux-designer");
  assert.equal(config.templateId, "warm-macaron-v1");
  assert.deepEqual(config.styleVector, { E: 0.75, K: 0.5, P: 0.5, S: 0.5, PChoice: "warm" });
  // 存量回归：warm-v1 仍可映射
  assert.equal(templateToConfig("warm-v1", "ui-ux-designer").templateId, "warm-v1");
});

test("design-config V4 schema 枚举 warm-macaron-v1 并保留 warm-v1", () => {
  assert.ok(designConfigV4Schema.properties.templateId.enum.includes("warm-macaron-v1"));
  assert.ok(designConfigV4Schema.properties.templateId.enum.includes("warm-v1"));
});

test("V4 合同接受对象形态的 heroPhoto 并拒绝非对象值", () => {
  assert.ok(designConfigV4Schema.properties.heroPhoto.anyOf.some(({ $ref }) => $ref === "#/$defs/HeroPhoto"));
  assert.ok(heroPhotoAccepted({ assetUrl: "data:image/png;base64,x", alt: "测试" }));
  assert.equal(heroPhotoAccepted(123), false);
});

test("generation-brief V4 schema 枚举新模板但不感知 heroPhoto", () => {
  const briefSchema = JSON.parse(readFileSync(
    new URL("../../contracts/schema/generation-brief.v4.json", import.meta.url), "utf8"));
  assert.ok(briefSchema.properties.templateId.enum.includes("warm-macaron-v1"));
  assert.ok(briefSchema.properties.templateId.enum.includes("warm-v1"));
  assert.equal("heroPhoto" in briefSchema.properties, false);
});
