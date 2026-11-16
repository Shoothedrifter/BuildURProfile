import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWebEnv } from './web-env.mjs';

// 模拟操作者按 AGENTS.md 允许的「注入进程环境」方式（shell 导出或根 .env）
// 提供的全部 Agent 专用变量，以及 web 进程正常需要的变量。
const sampleEnv = {
  PATH: '/usr/bin',
  NODE_ENV: 'development',
  AGENT_SERVICE_TOKEN: 'token-value',
  SERVER_HOST: '127.0.0.1',
  OPENAI_API_KEY: 'sk-1',
  OPENAI_IMAGE_MODEL: 'gpt-image-1',
  RESUME_TEXT_MODEL: 'glm-5.3',
  ZAI_API_KEY: 'zai-1',
  SILICONFLOW_API_KEY: 'sf-1',
  CLOUDFLARE_API_TOKEN: 'cf-1',
  CLOUDFLARE_ACCOUNT_ID: 'acc-1'
};

test('sanitizeWebEnv 剔除 SILICONFLOW_API_KEY，防止硅基流动密钥泄漏进 web 进程', () => {
  const webEnv = sanitizeWebEnv(sampleEnv);
  assert.equal(
    webEnv.SILICONFLOW_API_KEY,
    undefined,
    'SILICONFLOW_API_KEY 是 Agent 专用密钥，不应出现在 web 子进程 env 中'
  );
});

test('sanitizeWebEnv 仍剔除既有六项 Agent 专用变量（防回归）', () => {
  const webEnv = sanitizeWebEnv(sampleEnv);
  for (const key of [
    'OPENAI_API_KEY',
    'OPENAI_IMAGE_MODEL',
    'RESUME_TEXT_MODEL',
    'ZAI_API_KEY',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID'
  ]) {
    assert.equal(webEnv[key], undefined, `${key} 应被剔除出 web 子进程 env`);
  }
});

test('sanitizeWebEnv 保留清洗清单之外的变量且不修改入参', () => {
  const input = { ...sampleEnv };
  const webEnv = sanitizeWebEnv(input);
  assert.equal(webEnv.PATH, '/usr/bin');
  assert.equal(webEnv.NODE_ENV, 'development');
  assert.equal(webEnv.AGENT_SERVICE_TOKEN, 'token-value');
  assert.equal(webEnv.SERVER_HOST, '127.0.0.1');
  // 纯函数：调用方传入的对象（尤其是展开自 process.env 的副本）不被就地修改
  assert.deepEqual(
    Object.keys(input).sort(),
    Object.keys(sampleEnv).sort(),
    'sanitizeWebEnv 不应修改传入的 env 对象'
  );
});
