const TASK_SECTION = /^(?:待办(?:事项)?|任务(?:清单)?|行动项|下一步(?:行动)?|执行计划|todo(?:s)?|action items|next steps)$/i
const ACTION_START = /^(?:请|需要|应当|应该|尽快|完成|提交|创建|更新|检查|联系|准备|确认|整理|编写|发送|处理|评估|修复|补充|实现|配置|收集|审查|review\b|update\b|create\b|check\b|contact\b|prepare\b|confirm\b|write\b|send\b|fix\b|implement\b|configure\b|collect\b|submit\b|complete\b)/i

function cleanTaskTitle(value: string) {
  return value
    .replace(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/, '$1')
    .replace(/^\s*`(.+)`\s*$/, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractOpenTasks(content: string): string[] {
  const tasks: string[] = []
  const seen = new Set<string>()
  const addTask = (value: string) => {
    const title = cleanTaskTitle(value)
    const key = title.toLocaleLowerCase()
    if (title && !seen.has(key)) {
      seen.add(key)
      tasks.push(title)
    }
  }
  let inCodeBlock = false
  let inTaskSection = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock || !line) continue

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (heading) {
      const title = heading[1].replace(/[:：]\s*$/, '').trim()
      inTaskSection = TASK_SECTION.test(title)
      continue
    }
    const sectionLabel = line.match(/^([^:：]{1,24})[:：]\s*$/)
    if (sectionLabel) {
      inTaskSection = TASK_SECTION.test(sectionLabel[1].trim())
      continue
    }

    const checkbox = line.match(/^(?:[-*+•‣]\s+)?\[([ xX])\]\s+(.+)$/)
    if (checkbox) {
      if (checkbox[1] !== ' ') continue
      addTask(checkbox[2])
      continue
    }

    const todo = line.match(/^(?:[-*+•‣]\s+)?(?:TODO|待办|待处理)\s*[:：-]\s*(.+)$/i)
    const listItem = line.match(/^(?:[-*+•‣]|\d{1,3}[.)、])\s+(.+)$/)
    const candidate = todo?.[1] || listItem?.[1]
    if (!candidate || (!todo && !inTaskSection && !ACTION_START.test(candidate.trim()))) continue

    addTask(candidate)
  }

  return tasks
}
