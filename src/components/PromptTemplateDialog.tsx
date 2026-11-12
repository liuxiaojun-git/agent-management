import { useState } from 'react'
import {
  createBackendPromptTemplate,
  deleteBackendPromptTemplate,
  getBackendPromptTemplates,
  type PersonalPromptTemplate,
  type PersonalPromptTemplateInput,
  updateBackendPromptTemplate,
} from '../services/chatService'
import { Dialog, DialogActions, DialogError, DialogField, DialogHeader, Icon } from './OperationUI'
import { menuIcons } from './operationMenu'
import {
  promptTemplates,
  promptTemplateVariables,
  renderPersonalPromptTemplate,
  type PromptTemplate,
} from '../utils/promptTemplates'

interface PromptTemplateDialogProps {
  initialTemplateId?: string
  currentPrompt: string
  onClose: () => void
  onApply: (prompt: string) => void
}

const emptyInput: PersonalPromptTemplateInput = {
  title: '',
  category: '自定义',
  description: '',
  content: '',
  favorite: false,
}

function emptyValues(fields: PromptTemplate['fields']): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, '']))
}

function sortedTemplates(templates: PersonalPromptTemplate[]) {
  return [...templates].sort((a, b) =>
    Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt))
}

export default function PromptTemplateDialog({
  initialTemplateId = '',
  currentPrompt,
  onClose,
  onApply,
}: PromptTemplateDialogProps) {
  const [scope, setScope] = useState<'system' | 'personal'>('system')
  const [selectedId, setSelectedId] = useState(initialTemplateId)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const template = promptTemplates.find((item) => item.id === initialTemplateId)
    return emptyValues(template?.fields || [])
  })
  const [personalTemplates, setPersonalTemplates] = useState<PersonalPromptTemplate[]>([])
  const [personalTemplatesLoaded, setPersonalTemplatesLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<PersonalPromptTemplateInput>(emptyInput)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadPersonalTemplates = async () => {
    setLoading(true)
    setError('')
    try {
      const templates = await getBackendPromptTemplates()
      setPersonalTemplates(sortedTemplates(templates))
      setPersonalTemplatesLoaded(true)
      return templates
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '个人模板加载失败')
      return null
    } finally {
      setLoading(false)
    }
  }

  const selectedPersonal = personalTemplates.find((template) => String(template.id) === selectedId) || null
  const selectedSystem = scope === 'system'
    ? promptTemplates.find((template) => template.id === selectedId) || null
    : null
  const selectedTemplate: PromptTemplate | null = selectedSystem || (selectedPersonal ? {
    id: `personal-${selectedPersonal.id}`,
    title: selectedPersonal.title,
    description: selectedPersonal.description,
    category: selectedPersonal.category,
    fields: promptTemplateVariables(selectedPersonal.content).map((key) => ({
      key,
      label: key,
      placeholder: `填写${key}`,
      required: true,
      multiline: true,
    })),
    buildPrompt: (input) => renderPersonalPromptTemplate(selectedPersonal.content, input),
  } : null)
  const preview = selectedTemplate?.buildPrompt(values) || ''
  const missingFields = selectedTemplate?.fields.filter((field) => field.required && !values[field.key]?.trim()) || []

  const selectSystem = (template: PromptTemplate) => {
    setSelectedId(template.id)
    setValues(emptyValues(template.fields))
    setError('')
  }

  const selectPersonal = (template: PersonalPromptTemplate) => {
    const fields = promptTemplateVariables(template.content).map((key) => ({
      key,
      label: key,
      placeholder: `填写${key}`,
      required: true,
    }))
    setSelectedId(String(template.id))
    setValues(emptyValues(fields))
    setDeleteId(null)
    setError('')
  }

  const changeScope = (nextScope: 'system' | 'personal') => {
    setScope(nextScope)
    setSelectedId('')
    setValues({})
    setEditing(false)
    setDeleteId(null)
    setError('')
    if (nextScope === 'personal' && !personalTemplatesLoaded) void loadPersonalTemplates()
  }

  const startNewTemplate = () => {
    setEditingId(null)
    setForm({ ...emptyInput })
    setError('')
    setEditing(true)
  }

  const startEditTemplate = (template: PersonalPromptTemplate) => {
    setEditingId(template.id)
    setForm({
      title: template.title,
      category: template.category,
      description: template.description,
      content: template.content,
      favorite: template.favorite,
    })
    setError('')
    setEditing(true)
  }

  const saveTemplate = async () => {
    const input = {
      ...form,
      title: form.title.trim(),
      category: form.category.trim(),
      description: form.description.trim(),
      content: form.content,
    }
    if (!input.title || !input.category || !input.content) {
      setError('请填写模板名称、分类和正文。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = editingId
        ? await updateBackendPromptTemplate(editingId, input)
        : await createBackendPromptTemplate(input)
      setPersonalTemplates((current) => sortedTemplates([saved, ...current.filter((item) => item.id !== saved.id)]))
      setPersonalTemplatesLoaded(true)
      setSelectedId(String(saved.id))
      setValues(emptyValues(promptTemplateVariables(saved.content).map((key) => ({
        key, label: key, placeholder: `填写${key}`, required: true,
      }))))
      setEditing(false)
      setEditingId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模板保存失败')
    } finally {
      setBusy(false)
    }
  }

  const toggleFavorite = async (template: PersonalPromptTemplate) => {
    setBusy(true)
    setError('')
    try {
      const saved = await updateBackendPromptTemplate(template.id, {
        title: template.title,
        category: template.category,
        description: template.description,
        content: template.content,
        favorite: !template.favorite,
      })
      setPersonalTemplates((current) => sortedTemplates([saved, ...current.filter((item) => item.id !== saved.id)]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '收藏状态更新失败')
    } finally {
      setBusy(false)
    }
  }

  const deleteTemplate = async (templateId: number) => {
    setBusy(true)
    setError('')
    try {
      await deleteBackendPromptTemplate(templateId)
      setPersonalTemplates((current) => current.filter((template) => template.id !== templateId))
      if (selectedId === String(templateId)) {
        setSelectedId('')
        setValues({})
      }
      setDeleteId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模板删除失败')
    } finally {
      setBusy(false)
    }
  }

  const applyTemplate = () => {
    if (!selectedTemplate || missingFields.length > 0) return
    onApply(preview)
  }

  return (
    <Dialog onClose={onClose} width="2xl">
      <DialogHeader
        title={editing ? editingId ? '编辑个人模板' : '新建个人模板' : scope === 'personal' ? '我的提示词模板' : '系统提示词模板'}
        subtitle={editing
          ? '使用 {{变量名}} 添加可填写变量；模板仅保存，不会触发模型调用。'
          : currentPrompt.trim()
            ? '填入会替换当前草稿；模型和附件不变，也不会自动发送。'
            : '填写并预览后填入输入框；模型和附件保持不变，不会自动发送。'}
        onClose={onClose}
      />

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <div className="mx-auto max-w-xl">
            <DialogField label="模板名称" required>
              <input
                autoFocus
                maxLength={100}
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                className="input input-bordered mt-1.5 w-full"
                placeholder="例如：每周项目进展总结"
              />
            </DialogField>
            <DialogField label="分类" required>
              <input
                maxLength={50}
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                className="input input-bordered mt-1.5 w-full"
                placeholder="例如：写作、分析、计划"
              />
            </DialogField>
            <DialogField label="用途说明">
              <input
                maxLength={500}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="input input-bordered mt-1.5 w-full"
                placeholder="简单说明此模板适合什么场景"
              />
            </DialogField>
            <DialogField label="提示词正文" required>
              <textarea
                maxLength={20000}
                value={form.content}
                onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                className="textarea textarea-bordered mt-1.5 min-h-48 w-full font-mono text-sm leading-6"
                placeholder={'请根据以下信息完成……\n\n目标：{{目标}}\n材料：{{材料}}'}
              />
            </DialogField>
            <p className="mt-2 text-xs leading-5 text-base-content/45">
              用双花括号定义变量，例如 <code>{'{{目标}}'}</code>。使用模板时会提示填写这些变量；同名变量只需填写一次。
              {promptTemplateVariables(form.content).length
                ? ` 当前变量：${promptTemplateVariables(form.content).join('、')}`
                : ' 当前没有变量，模板正文将直接填入输入框。'}
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-base-content/70">
              <input
                type="checkbox"
                className="checkbox checkbox-primary checkbox-sm"
                checked={form.favorite}
                onChange={(event) => setForm((current) => ({ ...current, favorite: event.target.checked }))}
              />
              收藏此模板
            </label>
          </div>
        ) : (
          <>
            <div className="mb-4 flex gap-2 border-b border-base-300">
              {(['system', 'personal'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => changeScope(item)}
                  aria-pressed={scope === item}
                  className={`border-b-2 px-3 py-2 text-sm font-medium transition ${scope === item ? 'border-primary text-primary' : 'border-transparent text-base-content/55 hover:text-base-content'}`}
                >
                  {item === 'system' ? '系统推荐' : `我的模板${personalTemplates.length ? ` (${personalTemplates.length})` : ''}`}
                </button>
              ))}
            </div>

            <div className="grid min-h-75 gap-4 md:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)]">
              <div className="space-y-2">
                {scope === 'system' ? promptTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => selectSystem(template)}
                    aria-pressed={selectedId === template.id}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selectedId === template.id ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-primary/40 hover:bg-base-200/50'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{template.title}</span>
                      <span className="text-[10px] text-base-content/45">{template.category}</span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-base-content/50">{template.description}</span>
                  </button>
                )) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-base-content/45">已收藏的模板排在前面</span>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => void loadPersonalTemplates()} disabled={loading || busy}>刷新</button>
                    </div>
                    <button type="button" className="btn btn-outline btn-sm w-full" onClick={startNewTemplate} disabled={busy}>
                      + 新建个人模板
                    </button>
                    {loading ? (
                      <div className="grid min-h-40 place-items-center"><span className="loading loading-spinner loading-md text-primary" /></div>
                    ) : personalTemplates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-base-300 p-4 text-center text-sm text-base-content/45">
                        暂无个人模板，创建后可在此管理和复用。
                      </div>
                    ) : personalTemplates.map((template) => (
                      <div key={template.id} className={`rounded-xl border p-2.5 transition ${selectedId === String(template.id) ? 'border-primary bg-primary/5' : 'border-base-300'}`}>
                        <div className="flex items-start gap-2">
                          <button type="button" onClick={() => selectPersonal(template)} aria-pressed={selectedId === String(template.id)} className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-sm font-medium">{template.title}</span>
                            <span className="mt-1 block truncate text-xs text-base-content/45">{template.category}{template.description ? ` · ${template.description}` : ''}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleFavorite(template)}
                            disabled={busy}
                            className={`rounded-md p-1.5 transition hover:bg-base-200 ${template.favorite ? 'text-amber-500' : 'text-base-content/35'}`}
                            title={template.favorite ? '取消收藏' : '收藏模板'}
                            aria-label={template.favorite ? '取消收藏' : '收藏模板'}
                          >
                            <Icon><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></Icon>
                          </button>
                          <button type="button" onClick={() => startEditTemplate(template)} disabled={busy} className="rounded-md p-1.5 text-base-content/45 transition hover:bg-base-200 hover:text-primary" title="编辑模板" aria-label="编辑模板">
                            {menuIcons.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeleteId(template.id); setError('') }}
                            disabled={busy}
                            className="rounded-md p-1.5 text-base-content/45 transition hover:bg-error/10 hover:text-error"
                            title="删除模板"
                            aria-label="删除模板"
                          >
                            {menuIcons.trash}
                          </button>
                        </div>
                        {deleteId === template.id ? (
                          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-error/5 px-2.5 py-2 text-xs">
                            <span className="text-error">确定删除此模板？</span>
                            <span className="flex gap-1">
                              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDeleteId(null)} disabled={busy}>取消</button>
                              <button type="button" className="btn btn-error btn-xs" onClick={() => void deleteTemplate(template.id)} disabled={busy}>
                                {busy ? '删除中…' : '删除'}
                              </button>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="min-h-0">
                {selectedTemplate ? <>
                  {selectedTemplate.fields.length > 0 ? (
                    <div className="space-y-3">
                      {selectedTemplate.fields.map((field) => (
                        <DialogField key={field.key} label={field.label} required={field.required}>
                          {field.multiline ? (
                            <textarea
                              value={values[field.key] || ''}
                              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                              className="textarea textarea-bordered mt-1.5 min-h-20 w-full text-sm"
                              placeholder={field.placeholder}
                            />
                          ) : (
                            <input
                              value={values[field.key] || ''}
                              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                              className="input input-bordered mt-1.5 w-full text-sm"
                              placeholder={field.placeholder}
                            />
                          )}
                        </DialogField>
                      ))}
                    </div>
                  ) : <p className="text-xs text-base-content/45">此模板没有变量，正文将直接填入输入框。</p>}
                  <div className="mt-4">
                    <p className="text-xs font-medium text-base-content/60">提示词预览</p>
                    <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-base-200/70 p-3 text-xs leading-5 text-base-content/75">{preview}</pre>
                  </div>
                </> : (
                  <div className="grid min-h-60 place-items-center rounded-xl border border-dashed border-base-300 p-6 text-center text-sm text-base-content/45">
                    {scope === 'personal' && loading ? '正在加载个人模板…' : '选择左侧模板后填写内容并预览'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        <DialogError>{error}</DialogError>
      </div>

      {!editing && missingFields.length > 0 ? (
        <p className="mt-3 text-xs text-base-content/45">请填写必填项：{missingFields.map((field) => field.label).join('、')}</p>
      ) : null}
      <DialogActions>
        {editing ? <>
          <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setError('') }} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void saveTemplate()} disabled={busy || !form.title.trim() || !form.category.trim() || !form.content.trim()}>
            {busy ? '保存中…' : editingId ? '保存修改' : '创建模板'}
          </button>
        </> : <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" onClick={applyTemplate} disabled={!selectedTemplate || missingFields.length > 0}>
            填入输入框
          </button>
        </>}
      </DialogActions>
    </Dialog>
  )
}
