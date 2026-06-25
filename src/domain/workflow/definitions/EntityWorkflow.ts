import type { WorkflowDefinition } from "../core/WorkflowEngine.ts";
import {
    BuildPrompt,
    CleanRegex,
    FetchContext,
    FetchExistingEntities,
    LlmRequest,
    ParseJson,
    SaveEntity,
    UserReview,
} from "../steps/index.ts";
import { ResolveEntitiesStep } from "../steps/extraction/ResolveEntitiesStep.ts";

export const createEntityWorkflow = (): WorkflowDefinition => ({
    name: "EntityWorkflow",
    steps: [
        new FetchContext(),
        new FetchExistingEntities(),
        new BuildPrompt({ category: "entity_extraction" }),
        new LlmRequest(),
        new CleanRegex("output"), // V0.9.1: 清洗思维链等标签
        new ParseJson(),
        // episode-as-source-of-truth：在保存前合并重复实体（embedding+LLM 两段式解析）。
        // ignoreFailure=true：解析失败时降级为字符串解析，不中断 workflow。
        new ResolveEntitiesStep(),
        // V1.2.7: 预览步骤 - DryRun 模式生成 newEntities/updatedEntities 供 UI 显示
        new SaveEntity({ dryRun: true }),
        // Add Review Step
        new UserReview({
            description:
                "请确认提取的实体列表 (JSON/YAML)。您可以直接编辑以修正错误。",
            title: "实体提取确认",
        }),
        // V1.2.7: 实际保存步骤 - 使用用户可能修改后的数据
        new SaveEntity({ dryRun: false }),
    ],
});
