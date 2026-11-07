# Skills 包

此包提供浏览器与 TS Skills、TS 评分与设计规则、公共肖像风格目录，以及仅服务端可用的固定资源校验。Python LangGraph 使用自身的 `apps/agent/src/buildurprofile_agent/skills/registry.py`，不执行此 TS 注册表。

## 入口与边界

| 文件 | 用途 |
| --- | --- |
| `src/registry.ts` | 浏览器安全的 Skill 注册表，支持版本、输入输出、运行位置、能力、超时与许可校验 |
| `src/assessment.ts`、`src/mapping.ts` | 确定性评分和设计映射规则 |
| `src/avatar-catalog.ts` | 浏览器可用的三风格目录 |
| `src/wibi.ts` | 仅服务端使用；校验并读取固定本机风格资源，不打包进浏览器客户端 |

前端使用 `resume.extract.v1`、`resume.parse.v1`、`resume.confirm.v1`。注册表保留评分、设计、内容组装与 worker 类型的声明及兼容测试，TS/Python 的规则一致性由共享黄金样例验证。

`run` 在超时后中止信号；`runSync` 只能在同步函数返回后检查耗时，不能中断同步执行。能力实现须遵守取消信号或自行限制耗时。

## 固定资源与扩展

Wibi 固定提交 `17880b82ea35c1fe1ec4b8f907a053d314df464f`，按 SHA-256 校验清单、提示词和参考图，只读取三种已审查风格。资源属于声明式配方，不执行下载包中的脚本或外部指令；配方返回来源与许可元数据。

新增 Skill 需定义稳定 ID、版本、输入输出、运行位置、允许能力、超时与许可，并测试非法输入、缺失能力和越权调用。不得开放支付、会话密钥、任意 shell 或不受限文件系统访问。

在根目录运行 `npm run test:skills`；涉及跨语言规则时再运行 `npm run test:agent`。Wibi 许可、安装与上线门槛见 [Agent 说明](../../docs/agent/README.md)。
