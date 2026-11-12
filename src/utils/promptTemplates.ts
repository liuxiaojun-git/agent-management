export type PromptTemplateField = {
  key: string
  label: string
  placeholder: string
  required?: boolean
  multiline?: boolean
}

export type PromptTemplate = {
  id: string
  title: string
  description: string
  category: string
  fields: PromptTemplateField[]
  buildPrompt: (values: Record<string, string>) => string
}

export const promptTemplates: PromptTemplate[] = [
  {
    id: 'product-requirement',
    title: '撰写产品需求',
    description: '梳理目标用户、需求范围和验收标准。',
    category: '产品',
    fields: [
      { key: 'topic', label: '需求主题', placeholder: '例如：知识库文档批量导入', required: true },
      { key: 'users', label: '目标用户', placeholder: '例如：需要整理项目资料的产品团队' },
      { key: 'constraints', label: '已知约束', placeholder: '例如：兼容现有权限和文件格式' },
    ],
    buildPrompt: (values) => `请帮我撰写一份「${values.topic.trim()}」的产品需求文档。
${values.users.trim() ? `目标用户：${values.users.trim()}\n` : ''}${values.constraints.trim() ? `已知约束：${values.constraints.trim()}\n` : ''}请包含背景与目标、用户场景、功能范围、主要流程、异常情况和验收标准。对未提供的信息请明确标注待确认，不要自行假设。`,
  },
  {
    id: 'data-analysis',
    title: '分析数据',
    description: '围绕目标分析数据，提炼结论与下一步建议。',
    category: '分析',
    fields: [
      { key: 'goal', label: '分析目标', placeholder: '例如：找出本月转化率下降的原因', required: true },
      { key: 'context', label: '背景或口径', placeholder: '说明数据来源、时间范围或指标口径' },
      { key: 'data', label: '数据内容（可选）', placeholder: '粘贴数据；也可以稍后在对话中提供或上传附件', multiline: true },
    ],
    buildPrompt: (values) => `请基于${values.data.trim() ? '以下数据' : '我随后提供的数据或附件'}完成分析。
分析目标：${values.goal.trim()}
${values.context.trim() ? `背景或口径：${values.context.trim()}\n` : ''}${values.data.trim() ? `数据：\n${values.data.trim()}\n` : ''}请先说明数据限制，再给出关键发现、可能原因及可执行的下一步建议；区分事实与推测，不要编造数据。`,
  },
  {
    id: 'copy-edit',
    title: '优化文案',
    description: '按目标读者和语气调整表达，并保留原意。',
    category: '写作',
    fields: [
      { key: 'content', label: '原文', placeholder: '粘贴需要优化的文案', required: true, multiline: true },
      { key: 'audience', label: '目标读者', placeholder: '例如：企业客户、团队成员' },
      { key: 'tone', label: '期望风格', placeholder: '例如：简洁专业、亲切自然' },
    ],
    buildPrompt: (values) => `请帮我优化下面这段文案，保留原意，不补充未经提供的事实。
${values.audience.trim() ? `目标读者：${values.audience.trim()}\n` : ''}${values.tone.trim() ? `期望风格：${values.tone.trim()}\n` : ''}请先给出优化后的版本，再简要说明主要调整。

原文：
${values.content.trim()}`,
  },
  {
    id: 'article-summary',
    title: '总结文章',
    description: '提炼核心观点、关键依据和待确认问题。',
    category: '阅读',
    fields: [
      { key: 'material', label: '文章或材料（可选）', placeholder: '粘贴内容；也可以稍后在对话中提供或上传附件', multiline: true },
      { key: 'focus', label: '关注重点', placeholder: '例如：结论、风险、对团队的影响' },
    ],
    buildPrompt: (values) => `请总结${values.material.trim() ? '以下材料' : '我随后提供的文章或附件'}。
${values.focus.trim() ? `重点关注：${values.focus.trim()}\n` : ''}请按“概要、核心观点、关键依据、值得进一步确认的问题”组织答案。只基于材料内容总结；无法从材料确认的信息请明确说明。
${values.material.trim() ? `\n材料：\n${values.material.trim()}` : ''}`,
  },
  {
    id: 'work-plan',
    title: '制定工作计划',
    description: '拆分阶段、行动项和可检查的交付结果。',
    category: '计划',
    fields: [
      { key: 'goal', label: '工作目标', placeholder: '例如：完成新版本上线准备', required: true },
      { key: 'deadline', label: '期望完成时间（可选）', placeholder: '例如：11 月底；不确定可留空' },
      { key: 'resources', label: '可用资源或限制', placeholder: '例如：2 人协作，每周投入 1 天' },
    ],
    buildPrompt: (values) => `请为「${values.goal.trim()}」制定一份可执行的工作计划。
${values.deadline.trim() ? `期望完成时间：${values.deadline.trim()}\n` : ''}${values.resources.trim() ? `可用资源或限制：${values.resources.trim()}\n` : ''}请拆分阶段、具体行动项、预期交付物和检查标准；未提供的时间或资源不要自行假设，并标注需要确认的事项。`,
  },
]

export function promptTemplateVariables(content: string): string[] {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((match) => match[1].trim())
    .filter(Boolean))]
}

export function renderPersonalPromptTemplate(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, rawName: string) => {
    const name = rawName.trim()
    return values[name]?.trim() || placeholder
  })
}
