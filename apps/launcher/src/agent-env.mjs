import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// 读取并解析 .env.agent；文件不存在时返回空对象。
// parseEnv 返回 null 原型对象，这里展开为普通对象方便调用方使用。
export function readAgentEnvFile(path = '.env.agent') {
  if (!existsSync(path)) return {};
  return { ...parseEnv(readFileSync(path, 'utf8')) };
}

// 把 .env.agent 的全部变量合并进 Agent 进程环境：
// 剔除 Web 专用的支付和发布配置，文件值优先于进程环境。
// 有意不做白名单——新增供应商（如 fallback 池）只需写进 .env.agent 即可透传。
export function applyAgentEnvFile(env, file) {
  Object.assign(env, file);
  for (const key of Object.keys(env)) {
    if (key.startsWith('ALIPAY_') || key.startsWith('PAYMENT_') || key.startsWith('GITHUB_PAGES_')) delete env[key];
  }
  return env;
}
