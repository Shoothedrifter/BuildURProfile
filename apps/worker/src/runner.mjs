import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export function openPrivateCheckpointer(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, "a", 0o600));
  chmodSync(path, 0o600);
  return SqliteSaver.fromConnString(path);
}

export async function runNextGeneration({ service, graph }) {
  const task = service.leaseNext();
  if (!task) return false;
  const config = { configurable: { thread_id: task.id } };
  try {
    const snapshot = await graph.getState(config);
    if (snapshot?.values?.taskId && snapshot.next?.length) await graph.invoke(null, config);
    else if (!snapshot?.values?.taskId) await graph.invoke({ taskId: task.id, portraitAssetId: task.portrait_asset_id,
      styleId: task.style_id, configJson: task.config_json, outputAssetId: task.output_asset_id }, config);
    service.complete(task.id);
  } catch (error) {
    const message = error instanceof Error && error.message.includes("OPENAI_API_KEY")
      ? "未配置 OPENAI_API_KEY，无法生成肖像。" : "生成失败；请检查图像服务、风格资源或照片后重新提交。";
    service.fail(task.id, message);
  }
  return true;
}
