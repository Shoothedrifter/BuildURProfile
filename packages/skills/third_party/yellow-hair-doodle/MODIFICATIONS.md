# BuildURProfile 对 yellow-hair-doodle 的修改

上游作者：@威比 Hunter Wei.（抖音、小红书同名）  
官方来源：https://github.com/Vieeeeeee/wibi-style/tree/main/skills/yellow-hair-doodle  
固定来源提交：`17880b82ea35c1fe1ec4b8f907a053d314df464f`

BuildURProfile 在 `packages/skills/src/wibi.ts` 中使用项目改写的运行提示词，代替上游 `references/style-prompt.md` 作为图像 API 的输入。改写重点是保留原照片的发型、马尾扎点高低、发束数量和已有配饰，并缩短原提示中的发浪描述。上游原文在私有安装目录中保持原样，加载时仍按 SHA-256 校验。

此版本是 BuildURProfile 的修改版，不是 Wibi Style 官方发布。保留并遵守同目录的上游 `LICENSE` 与 `NOTICE`；原风格的个人非商业限制仍然适用。
