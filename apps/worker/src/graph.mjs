import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { cleanConfig } from "../../api/src/service.mjs";

const State = Annotation.Root({
  taskId: Annotation(), portraitAssetId: Annotation(), styleId: Annotation(), configJson: Annotation(),
  recipeVersion: Annotation(), outputAssetId: Annotation(), heroArtwork: Annotation(),
  trace: Annotation({ reducer: (left, right) => [...left, ...right], default: () => [] })
});

export function buildGenerationGraph({ styleLoader, provider, assets, checkpointer }) {
  const graph = new StateGraph(State)
    .addNode("validateInput", (state) => {
      if (!state.taskId || Boolean(state.portraitAssetId) !== Boolean(state.styleId)) throw new Error("生成任务输入无效。");
      return { trace: ["validateInput"] };
    })
    .addNode("validateConfig", (state) => {
      if (state.configJson) cleanConfig(JSON.parse(state.configJson));
      return { trace: ["validateConfig"] };
    })
    .addNode("loadStyleRecipe", (state) => {
      const recipe = styleLoader(state.styleId);
      return { recipeVersion: recipe.version, trace: ["loadStyleRecipe"] };
    })
    .addNode("generateAvatar", async (state) => {
      if (state.outputAssetId && assets.outputExists(state.outputAssetId)) return { trace: ["generateAvatar"] };
      const existing = assets.existingOutput?.(state.taskId);
      if (existing && assets.outputExists(existing)) return { outputAssetId: existing, trace: ["generateAvatar"] };
      const recipe = styleLoader(state.styleId);
      if (recipe.version !== state.recipeVersion) throw new Error("风格版本在任务执行中发生变化。");
      const portrait = assets.readPortrait(state.portraitAssetId);
      const image = await provider.edit({ portrait, recipe });
      const outputAssetId = assets.storeOutput(state.taskId, image);
      return { outputAssetId, trace: ["generateAvatar"] };
    })
    .addNode("verifyAvatar", (state) => {
      if (!state.outputAssetId || !assets.outputExists(state.outputAssetId)) throw new Error("成图未通过资产校验。");
      return { trace: ["verifyAvatar"] };
    })
    .addNode("assembleHero", (state) => ({
      heroArtwork: state.outputAssetId ? {
        assetId: state.outputAssetId,
        styleId: state.styleId,
        templateId: "marquee-stacked-v1"
      } : null,
      trace: ["assembleHero"]
    }))
    .addNode("validateHero", (state) => {
      if (state.portraitAssetId && (state.heroArtwork?.assetId !== state.outputAssetId ||
        state.heroArtwork?.styleId !== state.styleId ||
        state.heroArtwork?.templateId !== "marquee-stacked-v1")) {
        throw new Error("首屏肖像引用无效。");
      }
      return { trace: ["validateHero"] };
    })
    .addNode("verifyArtifact", (state) => {
      if (state.portraitAssetId && (!state.outputAssetId || !state.heroArtwork || !assets.outputExists(state.outputAssetId))) {
        throw new Error("首屏肖像缺失。");
      }
      return { trace: ["verifyArtifact"] };
    })
    .addEdge(START, "validateInput")
    .addEdge("validateInput", "validateConfig")
    .addConditionalEdges("validateConfig", (state) => state.portraitAssetId ? "loadStyleRecipe" : "assembleHero")
    .addEdge("loadStyleRecipe", "generateAvatar")
    .addEdge("generateAvatar", "verifyAvatar")
    .addEdge("verifyAvatar", "assembleHero")
    .addEdge("assembleHero", "validateHero")
    .addEdge("validateHero", "verifyArtifact")
    .addEdge("verifyArtifact", END);
  return graph.compile({ checkpointer });
}
