// web 子进程（Next.js）环境变量清洗规则。
// 清单中的变量仅供 Python Agent 使用（模型供应商密钥与模型配置），
// 若操作者通过 shell 导出或根目录 .env 注入进程环境，会在 dev.mjs
// 展开 process.env 时进入 webEnv；这里统一剔除，避免密钥泄漏进 web 进程。
const WEB_EXCLUDED_KEYS = [
  'AGENT_CHECKPOINT_DATABASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_IMAGE_MODEL',
  'RESUME_TEXT_MODEL',
  'ZAI_API_KEY',
  'SILICONFLOW_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID'
];

// 返回剔除清洗清单键之后的新 env 对象；不修改传入对象。
// 新增 Agent 专用供应商密钥时应同步加入 WEB_EXCLUDED_KEYS 并补充测试。
export function sanitizeWebEnv(env) {
  const next = { ...env };
  for (const key of WEB_EXCLUDED_KEYS) delete next[key];
  for (const key of Object.keys(next)) if (key.startsWith("POSTGRES_")) delete next[key];
  return next;
}
