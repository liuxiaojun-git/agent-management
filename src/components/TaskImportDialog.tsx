import { useState } from 'react'
import type { PersonalTaskInput, TaskPriority } from '../services/chatService'
import { Dialog, DialogActions, DialogError, DialogHeader } from './OperationUI'

interface TaskImportDialogProps {
  extractedTasks: string[]
  onClose: () => void
  onSave: (tasks: PersonalTaskInput[]) => Promise<{ skipped: number }>
}

export default function TaskImportDialog({ extractedTasks, onClose, onSave }: TaskImportDialogProps) {
  const [tasks, setTasks] = useState<PersonalTaskInput[]>(() => extractedTasks.map((title) => ({
    title,
    description: '',
    priority: 'normal',
    dueDate: null,
  })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const save = async () => {
    const validTasks = tasks
      .map((task) => ({ ...task, title: task.title.trim(), description: task.description.trim() }))
      .filter((task) => task.title)
    if (!validTasks.length) {
      setError('请至少保留一项有效任务。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await onSave(validTasks)
      if (result.skipped) {
        setNotice(`这条 AI 回答已导入过，本次提交的 ${result.skipped} 项均已跳过，避免重复添加。`)
      } else {
        onClose()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加任务失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onClose={busy ? () => undefined : onClose} width="2xl">
      <DialogHeader
        title="添加到任务中心"
        subtitle="核对识别结果，可补充任务说明、优先级和截止日期；标题留空的项目不会提交。"
        onClose={busy ? () => undefined : onClose}
      />
      <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {tasks.map((task, index) => (
          <section key={index} className="rounded-xl border border-base-300/80 p-3">
            <div className="flex items-center gap-2">
              <input
                value={task.title}
                maxLength={200}
                onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))}
                className="input input-bordered input-sm w-full"
                aria-label={`任务 ${index + 1} 标题`}
                placeholder="任务标题"
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square text-error"
                onClick={() => setTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                disabled={busy}
                aria-label={`移除任务 ${index + 1}`}
                title="移除"
              >
                ×
              </button>
            </div>
            <textarea
              value={task.description}
              maxLength={5000}
              rows={2}
              onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))}
              className="textarea textarea-bordered textarea-sm mt-2 w-full"
              aria-label={`任务 ${index + 1} 说明`}
              placeholder="任务说明（可选）"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-base-content/55">
                优先级
                <select
                  value={task.priority}
                  onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, priority: event.target.value as TaskPriority } : item))}
                  className="select select-bordered select-sm mt-1 w-full"
                  aria-label={`任务 ${index + 1} 优先级`}
                >
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label className="text-xs text-base-content/55">
                截止日期
                <input
                  type="date"
                  value={task.dueDate || ''}
                  onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value || null } : item))}
                  className="input input-bordered input-sm mt-1 w-full"
                  aria-label={`任务 ${index + 1} 截止日期`}
                />
              </label>
            </div>
          </section>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setTasks((current) => [...current, { title: '', description: '', priority: 'normal', dueDate: null }])}
          disabled={busy}
        >
          + 手动添加任务
        </button>
        {tasks.length === 0 ? <p className="py-3 text-center text-sm text-base-content/50">没有待添加的任务。</p> : null}
      </div>
      <DialogError>{error}</DialogError>
      {notice ? <p className="mt-3 text-sm text-warning" role="status">{notice}</p> : null}
      <DialogActions>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{notice ? '关闭' : '取消'}</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || Boolean(notice) || !tasks.some((task) => task.title.trim())}>
          {busy ? '添加中…' : `添加 ${tasks.filter((task) => task.title.trim()).length} 项`}
        </button>
      </DialogActions>
    </Dialog>
  )
}
