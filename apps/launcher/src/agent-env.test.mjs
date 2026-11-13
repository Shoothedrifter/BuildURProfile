import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAgentEnvFile, readAgentEnvFile } from './agent-env.mjs';

let dir;
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-env-test-'));
});
test.after(() => rmSync(dir, { recursive: true, force: true }));

function writeEnvFile(content) {
  const path = join(dir, `.env.agent-${Math.random().toString(36).slice(2)}`);
  writeFileSync(path, content, 'utf8');
  return path;
}

test('readAgentEnvFile 解析 .env.agent 中的全部变量', () => {
  const path = writeEnvFile([
    'RESUME_TEXT_PROVIDER=zai',
    'RESUME_TEXT_MODEL=glm-5.3',
    'ZAI_API_KEY=secret-value',
    'OPENAI_IMAGE_MODEL=glm-5'
  ].join('\n'));
  assert.deepEqual(readAgentEnvFile(path), {
    RESUME_TEXT_PROVIDER: 'zai',
    RESUME_TEXT_MODEL: 'glm-5.3',
    ZAI_API_KEY: 'secret-value',
    OPENAI_IMAGE_MODEL: 'glm-5'
  });
});

test('readAgentEnvFile 文件不存在时返回空对象', () => {
  assert.deepEqual(readAgentEnvFile(join(dir, 'no-such-file')), {});
});

test('applyAgentEnvFile 把 .env.agent 的全部变量合并进 Agent 进程环境', () => {
  const file = readAgentEnvFile(writeEnvFile([
    'RESUME_TEXT_PROVIDER=zai',
    'RESUME_TEXT_MODEL=glm-5.3',
    'ZAI_API_KEY=secret-value'
  ].join('\n')));
  const env = applyAgentEnvFile({ PATH: '/usr/bin' }, file);
  assert.equal(env.RESUME_TEXT_PROVIDER, 'zai');
  assert.equal(env.RESUME_TEXT_MODEL, 'glm-5.3');
  assert.equal(env.ZAI_API_KEY, 'secret-value');
  assert.equal(env.PATH, '/usr/bin');
});

test('applyAgentEnvFile 新增供应商变量无需改启动脚本即可透传', () => {
  // 模拟未来 fallback 池新增的供应商变量
  const file = readAgentEnvFile(writeEnvFile([
    'DEEPSEEK_API_KEY=dk-1',
    'DASHSCOPE_API_KEY=qk-1',
    'RESUME_TEXT_FALLBACK_CHAIN=zai,deepseek,qwen'
  ].join('\n')));
  const env = applyAgentEnvFile({}, file);
  assert.equal(env.DEEPSEEK_API_KEY, 'dk-1');
  assert.equal(env.DASHSCOPE_API_KEY, 'qk-1');
  assert.equal(env.RESUME_TEXT_FALLBACK_CHAIN, 'zai,deepseek,qwen');
});

test('applyAgentEnvFile 剔除 ALIPAY_ 与 PAYMENT_ 前缀变量', () => {
  const file = readAgentEnvFile(writeEnvFile([
    'PAYMENT_ENV=sandbox',
    'ALIPAY_APP_ID=2088',
    'ZAI_API_KEY=secret-value'
  ].join('\n')));
  const env = applyAgentEnvFile({}, file);
  assert.equal(env.PAYMENT_ENV, undefined);
  assert.equal(env.ALIPAY_APP_ID, undefined);
  assert.equal(env.ZAI_API_KEY, 'secret-value');
});

test('applyAgentEnvFile 中 .env.agent 的值优先于进程环境同名变量', () => {
  const file = readAgentEnvFile(writeEnvFile('RESUME_TEXT_MODEL=glm-5.3'));
  const env = applyAgentEnvFile({ RESUME_TEXT_MODEL: 'old' }, file);
  assert.equal(env.RESUME_TEXT_MODEL, 'glm-5.3');
});
