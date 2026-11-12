import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  createBackendTaskProject,
  createBackendTasks,
  deleteBackendTaskProject,
  deleteBackendTasks,
  deleteBackendTask,
  getBackendTaskProjects,
  getBackendTaskAssignees,
  getBackendTasks,
  reorderBackendTaskProjects,
  updateBackendTaskProject,
  updateBackendTaskStatuses,
  updateBackendTask,
  getTaskImageObjectUrl,
  uploadTaskImage,
  type PersonalTask,
  type PersonalTaskInput,
  type TaskImage,
  type TaskProject,
  type TaskAssignee,
  type TaskDueFilter,
  type TaskPriority,
  type TaskSort,
  type TaskStatus,
  type TaskSummary,
} from '../services/chatService'
import { Dialog, DialogActions, DialogError, DialogField, DialogHeader, Icon, MenuAction, RowMenuPopover, RowMenuTrigger } from '../components/OperationUI'
import { menuIcons, useRowMenu } from '../components/operationMenu'
import { canAccess } from '../utils/permissions'

const statusLabels: Record<TaskStatus, string> = {
  pending: '未开始',
  in_progress: '进行中',
  paused: '已暂停',
  completed: '已完成',
}

const priorityLabels: Record<TaskPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
}

type TaskForm = PersonalTaskInput & {
  status: TaskStatus
  assignedUserId: number | null
  assignedUserName: string
  images: TaskImage[]
  imageFiles: File[]
  imageError: string
}

const emptyForm: TaskForm = {
  title: '',
  description: '',
  status: 'pending',
  priority: 'normal',
  dueDate: null,
  assignedUserId: null,
  assignedUserName: '',
  projectId: null,
  images: [],
  imageFiles: [],
  imageError: '',
}
type ActiveProjectId = number | 'all' | 'unassigned' | 'assigned'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function ProjectFolderIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 40 36" className={`h-9 w-10 shrink-0 ${active ? 'text-primary' : 'text-base-content/35'}`} aria-hidden="true">
      <path fill="currentColor" fillOpacity={active ? 0.3 : 0.16} d="M2 8a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z" />
      <path fill="currentColor" fillOpacity={active ? 0.55 : 0.25} d="M2 13h36v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z" />
    </svg>
  )
}

function TaskImagePreview({ image, file, onPreview }: { image?: TaskImage; file?: File; onPreview: () => void }) {
  const [loadedImage, setLoadedImage] = useState<{ id: string; url: string } | null>(null)
  const [failedImageId, setFailedImageId] = useState('')
  const localSrc = useMemo(() => file ? URL.createObjectURL(file) : '', [file])

  useEffect(() => {
    if (localSrc) return () => URL.revokeObjectURL(localSrc)
  }, [localSrc])

  useEffect(() => {
    if (file || !image) return
    const controller = new AbortController()
    let active = true
    let objectUrl = ''
    void getTaskImageObjectUrl(image.id, controller.signal)
      .then((url) => {
        objectUrl = url
        if (active) setLoadedImage({ id: image.id, url })
        else URL.revokeObjectURL(url)
      })
      .catch(() => {
        if (active) setFailedImageId(image.id)
      })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, image])

  const src = file ? localSrc : loadedImage && loadedImage.id === image?.id ? loadedImage.url : ''
  const loadError = failedImageId === image?.id
  return (
    <button
      type="button"
      className="flex h-full w-full items-center justify-center"
      onClick={onPreview}
      aria-label={`原像素预览：${image?.filename || file?.name || '任务图片'}`}
      title="点击查看原像素"
    >
      {src
        ? <img src={src} alt="" className="h-full w-full object-cover" />
        : <span className="flex h-full w-full items-center justify-center text-xs text-base-content/50">{loadError ? '加载失败' : '加载中'}</span>}
    </button>
  )
}

function TaskImageLightbox({ image, file, onClose }: { image?: TaskImage; file?: File; onClose: () => void }) {
  const [remoteSrc, setRemoteSrc] = useState('')
  const [error, setError] = useState('')
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [originalSize, setOriginalSize] = useState(false)
  const localSrc = useMemo(() => file ? URL.createObjectURL(file) : '', [file])

  useEffect(() => {
    if (localSrc) return () => URL.revokeObjectURL(localSrc)
  }, [localSrc])

  useEffect(() => {
    if (file || !image) return
    const controller = new AbortController()
    let active = true
    let objectUrl = ''
    void getTaskImageObjectUrl(image.id, controller.signal)
      .then((url) => {
        objectUrl = url
        if (active) setRemoteSrc(url)
        else URL.revokeObjectURL(url)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '图片加载失败')
      })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, image])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const src = file ? localSrc : remoteSrc
  return (
    <div
      className="fixed inset-0 z-80 flex flex-col bg-black/90 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="任务图片预览"
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 py-3 sm:px-6" onClick={(event) => event.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{image?.filename || file?.name || '任务图片'}</p>
          <p className="text-xs text-white/65">
            {dimensions ? `${dimensions.width} × ${dimensions.height} 像素${originalSize ? ' · 原始尺寸' : ''}` : error || '正在加载图片…'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dimensions ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-white hover:bg-white/15"
              onClick={() => setOriginalSize((current) => !current)}
            >
              {originalSize ? '适应窗口' : '原始尺寸'}
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm text-white hover:bg-white/15" onClick={onClose} aria-label="关闭图片预览">
            关闭
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto flex min-h-full w-max min-w-full items-center justify-center">
          {src ? (
            <img
              src={src}
              alt={image?.filename || file?.name || '任务图片'}
              className={originalSize
                ? 'block max-w-none'
                : 'block max-h-[calc(100vh-9rem)] max-w-[calc(100vw-2rem)] object-contain sm:max-w-[calc(100vw-3rem)]'}
              style={originalSize && dimensions ? { width: dimensions.width, height: dimensions.height } : undefined}
              onLoad={(event) => setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })}
            />
          ) : error ? (
            <p className="text-sm text-white/75" role="alert">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function TasksPage() {
  const isAdmin = canAccess('users')
  const projectWorkspaceRef = useRef<HTMLDivElement>(null)
  const projectPaneDragging = useRef(false)
  const projectPaneStartX = useRef(0)
  const projectPaneStartWidth = useRef(280)
  const projectPaneWidthRef = useRef(280)
  const [projectPaneWidth, setProjectPaneWidth] = useState(280)
  const [tasks, setTasks] = useState<PersonalTask[]>([])
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [unassignedCount, setUnassignedCount] = useState(0)
  const [assignedCount, setAssignedCount] = useState(0)
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [activeProjectId, setActiveProjectId] = useState<ActiveProjectId>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('')
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [dueFilter, setDueFilter] = useState<TaskDueFilter | ''>('')
  const [sort, setSort] = useState<TaskSort>('default')
  const [summary, setSummary] = useState<TaskSummary | null>(null)
  const [allTasksSelected, setAllTasksSelected] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([])
  const [deleteSelected, setDeleteSelected] = useState(false)
  const selectPageRef = useRef<HTMLInputElement>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [editingTask, setEditingTask] = useState<PersonalTask | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ image?: TaskImage; file?: File } | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [deleteTask, setDeleteTask] = useState<PersonalTask | null>(null)
  const [projectDialog, setProjectDialog] = useState<{ id: number | null; name: string } | null>(null)
  const [deleteProject, setDeleteProject] = useState<TaskProject | null>(null)
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null)
  const [projectDropTarget, setProjectDropTarget] = useState<{ id: number; position: 'before' | 'after' } | null>(null)
  const rowMenu = useRowMenu()
  const { openMenuId, menuAnchor, panelRef: rowMenuRef, close: closeRowMenu } = rowMenu
  useEffect(() => {
    projectPaneWidthRef.current = projectPaneWidth
  }, [projectPaneWidth])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!projectPaneDragging.current) return
      const workspaceWidth = projectWorkspaceRef.current?.clientWidth || window.innerWidth
      const maximumWidth = Math.min(320, workspaceWidth - 260 - 8)
      const nextWidth = Math.max(150, Math.min(maximumWidth, projectPaneStartWidth.current + event.clientX - projectPaneStartX.current))
      setProjectPaneWidth(nextWidth)
    }
    const handlePointerUp = () => {
      if (!projectPaneDragging.current) return
      projectPaneDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])
  const selectableTasks = tasks.filter((task) => !task.isAssignedToMe)
  const allPageSelected = selectableTasks.length > 0 && selectableTasks.every((task) => selectedTaskIds.includes(task.id))
  const activeProjectName = activeProjectId === 'all'
    ? '全部任务'
    : activeProjectId === 'unassigned'
      ? '未分类'
      : activeProjectId === 'assigned'
        ? '分配给我的'
        : projects.find((project) => project.id === activeProjectId)?.name || '项目'

  useEffect(() => {
    if (selectPageRef.current) {
      selectPageRef.current.indeterminate = selectedTaskIds.length > 0 && !allPageSelected
    }
  }, [selectedTaskIds, allPageSelected])

  const refresh = useCallback(() => {
    setError('')
    setLoading(true)
    setSelectedTaskIds([])
    setRefreshKey((current) => current + 1)
  }, [])

  useEffect(() => {
    let active = true
    void getBackendTasks({ page, pageSize: 20, projectId: activeProjectId, status: statusFilter, keyword: appliedKeyword, due: dueFilter, sort })
      .then((result) => {
        if (!active) return
        setTasks(result.items)
        setTotalPages(result.totalPages)
        setSummary(result.summary)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '任务加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [page, activeProjectId, statusFilter, appliedKeyword, dueFilter, sort, refreshKey])

  useEffect(() => {
    let active = true
    void getBackendTaskProjects()
      .then((result) => {
        if (!active) return
        setProjects(result.projects)
        setUnassignedCount(result.unassignedCount)
        setAssignedCount(result.assignedCount)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '项目目录加载失败')
      })
    return () => { active = false }
  }, [refreshKey])

  useEffect(() => {
    if (!isAdmin) return
    let active = true
    void getBackendTaskAssignees()
      .then((result) => {
        if (active) setAssignees(result)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '任务负责人加载失败')
      })
    return () => { active = false }
  }, [isAdmin])

  useEffect(() => {
    const nextKeyword = keyword.trim()
    if (nextKeyword === appliedKeyword) return
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      setPage(1)
      setAppliedKeyword(nextKeyword)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [keyword, appliedKeyword])

  const openCreate = () => {
    setEditingTask(null)
    setForm({ ...emptyForm, projectId: typeof activeProjectId === 'number' ? activeProjectId : null })
    setError('')
    setCreatingTask(true)
  }

  const openEdit = (task: PersonalTask) => {
    setEditingTask(task)
    setForm({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      assignedUserId: task.assignedUserId,
      assignedUserName: task.assignedUserName || '',
      projectId: task.projectId,
      images: task.images || [],
      imageFiles: [],
      imageError: '',
    })
    setError('')
  }

  const saveTask = async () => {
    const input = {
      title: form.title.trim(),
      description: form.description.trim(),
      status: form.status,
      priority: form.priority,
      dueDate: form.dueDate,
      projectId: form.projectId,
      ...(isAdmin ? { assignedUserId: form.assignedUserId } : {}),
    }
    if (!input.title) {
      setError('请输入任务标题。')
      return
    }
    if (form.imageError) {
      setError(form.imageError)
      return
    }
    setBusy(true)
    setError('')
    try {
      const uploadedImages = []
      for (const file of form.imageFiles) uploadedImages.push(await uploadTaskImage(file))
      const imageIds = [...form.images.map((image) => image.id), ...uploadedImages.map((image) => image.id)]
      if (editingTask) {
        await updateBackendTask(editingTask.id, { ...input, imageIds })
      } else {
        await createBackendTasks([{
          title: input.title,
          description: input.description,
          priority: input.priority,
          dueDate: input.dueDate,
          imageIds,
          ...(isAdmin ? { assignedUserId: form.assignedUserId } : {}),
        }], undefined, input.projectId)
        setKeyword('')
        setAppliedKeyword('')
        setStatusFilter('')
        setPage(1)
      }
      setEditingTask(null)
      setCreatingTask(false)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务保存失败')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (task: PersonalTask, status: TaskStatus) => {
    setBusy(true)
    setError('')
    try {
      await updateBackendTask(task.id, {
        title: task.title,
        description: task.description,
        status,
        priority: task.priority,
        dueDate: task.dueDate,
        projectId: task.projectId,
      })
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务状态更新失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTask) return
    setBusy(true)
    setError('')
    try {
      await deleteBackendTask(deleteTask.id)
      setDeleteTask(null)
      if (tasks.length === 1 && page > 1) setPage((current) => current - 1)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务删除失败')
    } finally {
      setBusy(false)
    }
  }

  const togglePageSelection = (checked: boolean) => {
    setSelectedTaskIds((current) => {
      const currentPageIds = new Set(selectableTasks.map((task) => task.id))
      const retained = current.filter((id) => !currentPageIds.has(id))
      return checked ? [...retained, ...currentPageIds] : retained
    })
  }

  const changeSelectedStatus = async (status: TaskStatus) => {
    if (!selectedTaskIds.length) return
    setBusy(true)
    setError('')
    try {
      await updateBackendTaskStatuses(selectedTaskIds, status)
      setSelectedTaskIds([])
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量更新任务状态失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmDeleteSelected = async () => {
    if (!selectedTaskIds.length) return
    setBusy(true)
    setError('')
    try {
      await deleteBackendTasks(selectedTaskIds)
      const deletedCurrentPage = selectedTaskIds.length === tasks.length
      setDeleteSelected(false)
      setSelectedTaskIds([])
      if (deletedCurrentPage && page > 1) setPage((current) => current - 1)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量删除任务失败')
    } finally {
      setBusy(false)
    }
  }

  const selectProject = (projectId: ActiveProjectId) => {
    if (projectId === activeProjectId) return
    setActiveProjectId(projectId)
    setSelectedTaskIds([])
    setLoading(true)
    setError('')
    setPage(1)
  }

  const finishProjectDrag = () => {
    setDraggedProjectId(null)
    setProjectDropTarget(null)
  }

  const moveProject = async (targetProjectId: number, position: 'before' | 'after') => {
    if (draggedProjectId === null || draggedProjectId === targetProjectId) return
    const sourceIndex = projects.findIndex((project) => project.id === draggedProjectId)
    const targetIndex = projects.findIndex((project) => project.id === targetProjectId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const previousProjects = projects
    const reordered = [...projects]
    const [movingProject] = reordered.splice(sourceIndex, 1)
    const adjustedTargetIndex = reordered.findIndex((project) => project.id === targetProjectId)
    const insertionIndex = adjustedTargetIndex + (position === 'after' ? 1 : 0)
    if (sourceIndex === insertionIndex || sourceIndex + 1 === insertionIndex) return
    reordered.splice(insertionIndex, 0, movingProject)
    setProjects(reordered)
    finishProjectDrag()
    setBusy(true)
    setError('')
    try {
      await reorderBackendTaskProjects(reordered.map((item) => item.id))
    } catch (cause) {
      setProjects(previousProjects)
      setError(cause instanceof Error ? cause.message : '项目排序保存失败')
    } finally {
      setBusy(false)
    }
  }

  const saveProject = async () => {
    if (!projectDialog) return
    const name = projectDialog.name.trim()
    if (!name) {
      setError('请输入项目名称。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (projectDialog.id === null) {
        const project = await createBackendTaskProject(name)
        setActiveProjectId(project.id)
      } else {
        await updateBackendTaskProject(projectDialog.id, name)
      }
      setProjectDialog(null)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目保存失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmDeleteProject = async () => {
    if (!deleteProject) return
    setBusy(true)
    setError('')
    try {
      await deleteBackendTaskProject(deleteProject.id)
      if (activeProjectId === deleteProject.id) setActiveProjectId('unassigned')
      setDeleteProject(null)
      refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目删除失败')
    } finally {
      setBusy(false)
    }
  }

  const focusDueTasks = (filter: TaskDueFilter) => {
    const needsReload = appliedKeyword !== '' || statusFilter !== '' || dueFilter !== filter || page !== 1
    setAllTasksSelected(false)
    setSelectedTaskIds([])
    setKeyword('')
    setAppliedKeyword('')
    setStatusFilter('')
    setDueFilter(filter)
    setPage(1)
    if (needsReload) setLoading(true)
    setError('')
  }

  const focusAllTasks = () => {
    const needsReload = appliedKeyword !== '' || statusFilter !== '' || dueFilter !== '' || page !== 1
    setAllTasksSelected(true)
    setSelectedTaskIds([])
    setKeyword('')
    setAppliedKeyword('')
    setStatusFilter('')
    setDueFilter('')
    setPage(1)
    if (needsReload) setLoading(true)
    setError('')
  }

  const focusTaskStatus = (status: TaskStatus) => {
    const needsReload = appliedKeyword !== '' || statusFilter !== status || dueFilter !== '' || page !== 1
    setAllTasksSelected(false)
    setSelectedTaskIds([])
    setKeyword('')
    setAppliedKeyword('')
    setStatusFilter(status)
    setDueFilter('')
    setPage(1)
    if (needsReload) setLoading(true)
    setError('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden md:min-h-155 md:gap-6">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-base-content sm:text-2xl">任务中心</h1>
        <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={openCreate}>
          <Icon><path d="M12 5v14M5 12h14" /></Icon>
          新建任务
        </button>
      </header>

      <div
        ref={projectWorkspaceRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-base-200 bg-base-100 shadow-sm md:flex-row"
        style={{ '--project-pane-width': `${projectPaneWidth}px` } as CSSProperties}
      >
      <aside className="flex max-h-36 shrink-0 flex-col overflow-hidden border-b border-base-200 bg-base-100 md:max-h-none md:w-(--project-pane-width) md:border-b-0 md:border-r" aria-label="项目目录">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-base-200 px-3 sm:px-4 md:h-14">
          <h2 className="text-sm font-semibold">项目目录</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={() => { setError(''); setProjectDialog({ id: null, name: '' }) }}
            aria-label="新建项目"
            title="新建项目"
          >
            <Icon><path d="M12 5v14M5 12h14" /></Icon>
          </button>
        </div>
        <nav className="flex min-h-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden p-2 md:block md:space-y-1 md:overflow-x-hidden md:overflow-y-auto">
          <button
            type="button"
            onClick={() => selectProject('all')}
            aria-current={activeProjectId === 'all' ? 'page' : undefined}
            className={`mb-1 flex w-auto min-w-36 shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors md:w-full ${activeProjectId === 'all' ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/60 hover:bg-base-200/70'}`}
          >
            <ProjectFolderIcon active={activeProjectId === 'all'} />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">全部任务</span>
            <span className="shrink-0 text-base-content/30">({projects.reduce((count, project) => count + project.taskCount, unassignedCount + assignedCount)})</span>
          </button>
          <button
            type="button"
            onClick={() => selectProject('unassigned')}
            aria-current={activeProjectId === 'unassigned' ? 'page' : undefined}
            className={`mb-1 flex w-auto min-w-36 shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors md:w-full ${activeProjectId === 'unassigned' ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/60 hover:bg-base-200/70'}`}
          >
            <ProjectFolderIcon active={activeProjectId === 'unassigned'} />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">未分类</span>
            <span className="shrink-0 text-base-content/30">({unassignedCount})</span>
          </button>
          {!isAdmin ? (
            <button
              type="button"
              onClick={() => selectProject('assigned')}
              aria-current={activeProjectId === 'assigned' ? 'page' : undefined}
              className={`mb-1 flex w-auto min-w-36 shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors md:w-full ${activeProjectId === 'assigned' ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/60 hover:bg-base-200/70'}`}
            >
              <ProjectFolderIcon active={activeProjectId === 'assigned'} />
              <span className="min-w-0 flex-1 truncate whitespace-nowrap">分配给我的</span>
              <span className="shrink-0 text-base-content/30">({assignedCount})</span>
            </button>
          ) : null}
          <div className="my-auto h-7 shrink-0 border-l border-base-200 md:my-2 md:h-0 md:border-l-0 md:border-t" />
          {projects.map((project) => (
            <div
              key={project.id}
              onDragOver={(event) => {
                if (draggedProjectId === null || draggedProjectId === project.id) return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                setProjectDropTarget({
                  id: project.id,
                  position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                })
              }}
              onDrop={(event) => {
                if (draggedProjectId === null || draggedProjectId === project.id) return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                void moveProject(project.id, position)
              }}
              className={`group relative mb-1 flex w-auto min-w-52 shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors md:w-full ${activeProjectId === project.id ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/60 hover:bg-base-200/70'} ${projectDropTarget?.id === project.id ? projectDropTarget.position === 'before' ? 'border-t-2 border-primary' : 'border-b-2 border-primary' : ''} ${draggedProjectId === project.id ? 'opacity-40' : ''}`}
            >
              <span
                className="cursor-grab select-none text-base-content/25 active:cursor-grabbing"
                draggable={!busy}
                title="拖动项目排序"
                aria-label={`拖动项目排序：${project.name}`}
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(project.id))
                  setDraggedProjectId(project.id)
                }}
                onDragEnd={finishProjectDrag}
              >
                ⠿
              </span>
              <button
                type="button"
                onClick={() => selectProject(project.id)}
                aria-current={activeProjectId === project.id ? 'page' : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ProjectFolderIcon active={activeProjectId === project.id} />
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{project.name}</span>
                <span className="shrink-0 text-base-content/30">({project.taskCount})</span>
              </button>
              <RowMenuTrigger
                open={openMenuId === `task-project-${project.id}`}
                onClick={(event) => {
                  event.stopPropagation()
                  rowMenu.toggle(`task-project-${project.id}`, event.currentTarget)
                }}
                label={`${project.name}操作`}
              />
              {openMenuId === `task-project-${project.id}` && menuAnchor ? (
                <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
                  <MenuAction
                    icon={menuIcons.edit}
                    label="重命名项目"
                    onClick={() => { closeRowMenu(); setError(''); setProjectDialog({ id: project.id, name: project.name }) }}
                  />
                  <MenuAction
                    icon={menuIcons.trash}
                    label="删除项目"
                    tone="danger"
                    onClick={() => { closeRowMenu(); setError(''); setDeleteProject(project) }}
                  />
                </RowMenuPopover>
              ) : null}
            </div>
          ))}
        </nav>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整项目目录宽度"
        aria-valuemin={150}
        aria-valuemax={320}
        aria-valuenow={projectPaneWidth}
        tabIndex={0}
        className="group hidden w-2 shrink-0 cursor-col-resize items-center justify-center bg-base-200/30 transition-colors hover:bg-base-200 focus-visible:bg-base-200 md:flex"
        onPointerDown={(event) => {
          event.preventDefault()
          projectPaneDragging.current = true
          projectPaneStartX.current = event.clientX
          projectPaneStartWidth.current = projectPaneWidthRef.current
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setProjectPaneWidth((current) => Math.max(150, Math.min(320, current + (event.key === 'ArrowRight' ? 16 : -16))))
        }}
      >
        <div className="h-8 w-0.5 rounded-full bg-base-content/20 transition-colors group-hover:bg-base-content/40" />
      </div>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-base-100">
        <div className="flex shrink-0 items-center border-b border-base-200 px-3 py-2.5 sm:px-6 sm:py-3">
          <h2 className="truncate text-lg font-semibold">{activeProjectName}</h2>
        </div>
      {summary ? (
        <section className="shrink-0 border-b border-base-200 p-3 sm:px-6 sm:pt-6 sm:pb-4" aria-label="任务统计与到期概览">
          {summary.overdue > 0 || summary.dueToday > 0 ? (
            <div className="alert alert-warning mb-3 flex flex-wrap justify-between gap-2 py-3" role="status">
              <span>
                {summary.overdue > 0 ? `有 ${summary.overdue} 项任务已逾期` : ''}
                {summary.overdue > 0 && summary.dueToday > 0 ? '；' : ''}
                {summary.dueToday > 0 ? `有 ${summary.dueToday} 项任务今天到期` : ''}
                ，记得及时处理。
              </span>
              <div className="flex gap-2">
                {summary.overdue > 0 ? <button type="button" className="link link-hover text-sm" onClick={() => focusDueTasks('overdue')}>查看逾期</button> : null}
                {summary.dueToday > 0 ? <button type="button" className="link link-hover text-sm" onClick={() => focusDueTasks('today')}>查看今天到期</button> : null}
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-base-300/80 bg-base-100 p-3 sm:p-4">
            <h2 className="mb-3 text-xs font-medium text-base-content/55">任务统计</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {([
                { status: '', label: '总任务', count: summary.totalTasks, style: 'text-base-content' },
                { status: 'pending', label: '未开始', count: summary.pending, style: 'text-base-content' },
                { status: 'in_progress', label: '进行中', count: summary.inProgress, style: 'text-info' },
                { status: 'paused', label: '已暂停', count: summary.paused, style: 'text-warning' },
                { status: 'completed', label: '已完成', count: summary.completed, style: 'text-base-content/55' },
              ] as const).map((item) => {
                const active = item.status ? statusFilter === item.status && !dueFilter : allTasksSelected
                return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.status ? focusTaskStatus(item.status) : focusAllTasks()}
                  aria-pressed={active}
                  className={`rounded-lg border p-3 text-left transition hover:border-primary/40 hover:bg-primary/5 ${active ? 'border-primary ring-1 ring-primary/30' : 'border-transparent'}`}
                >
                  <span className="block text-xs text-base-content/55">{item.label}</span>
                  <span className={`mt-1 block text-2xl font-semibold ${item.style}`}>{item.count}</span>
                </button>
                )
              })}
            </div>
          </div>
        </section>
      ) : null}

      <div className="shrink-0 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <label className="input input-bordered col-span-2 flex h-10 min-h-0 w-full min-w-0 items-center gap-2 rounded-2 text-sm sm:w-96 sm:shrink-0">
          <Icon className="text-base-content/40"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>
          <input
            value={keyword}
            onChange={(event) => { setAllTasksSelected(false); setSelectedTaskIds([]); setKeyword(event.target.value) }}
            className="grow"
            placeholder="模糊搜索任务标题或说明"
            aria-label="模糊搜索任务标题或说明"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => { setAllTasksSelected(false); setSelectedTaskIds([]); setLoading(true); setError(''); setStatusFilter(event.target.value as TaskStatus | ''); setPage(1) }}
          className="select select-bordered h-10 min-h-0 w-full min-w-0 rounded-2 sm:w-64 sm:shrink-0"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          value={dueFilter}
          onChange={(event) => { setAllTasksSelected(false); setSelectedTaskIds([]); setLoading(true); setError(''); setDueFilter(event.target.value as TaskDueFilter | ''); setPage(1) }}
          className="select select-bordered h-10 min-h-0 w-full min-w-0 rounded-2 sm:w-64 sm:shrink-0"
          aria-label="按到期时间筛选"
        >
          <option value="">全部到期时间</option>
          <option value="overdue">逾期未完成</option>
          <option value="today">今天到期</option>
          <option value="upcoming">未来 7 天到期</option>
        </select>
        <select
          value={sort}
          onChange={(event) => { setSelectedTaskIds([]); setLoading(true); setError(''); setSort(event.target.value as TaskSort); setPage(1) }}
          className="select select-bordered h-10 min-h-0 w-full min-w-0 rounded-2 sm:w-64 sm:shrink-0"
          aria-label="任务排序"
        >
          <option value="default">默认排序</option>
          <option value="priority">优先级优先</option>
          <option value="due_date">截止日期优先</option>
        </select>
        </div>
      </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
      {error && !editingTask && !deleteTask && !deleteSelected && !projectDialog && !deleteProject && !creatingTask ? <div className="alert alert-error mb-4 py-2 text-sm" role="alert">{error}</div> : null}
      <div className="space-y-3">
        {loading ? (
          <div className="grid min-h-48 place-items-center"><span className="loading loading-spinner loading-md text-primary" /></div>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-base-300 bg-base-100 p-10 text-center">
            <p className="font-medium">{appliedKeyword || statusFilter || dueFilter ? '没有符合筛选条件的任务' : activeProjectId === 'assigned' ? '还没有分配给你的任务' : '还没有任务'}</p>
            <p className="mt-1 text-sm text-base-content/50">
              {appliedKeyword || statusFilter || dueFilter
                ? '试试调整搜索词或筛选条件。'
                : activeProjectId === 'assigned'
                  ? '管理员分配任务后，会显示在这里。'
                  : '可以新建任务，或在 AI 对话回答中点击“添加到任务中心”。'}
            </p>
            {appliedKeyword || statusFilter || dueFilter ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => { setAllTasksSelected(false); setSelectedTaskIds([]); setKeyword(''); setAppliedKeyword(''); setStatusFilter(''); setDueFilter(''); setPage(1) }}
              >
                清除筛选
              </button>
            ) : null}
          </div>
        ) : tasks.map((task) => (
          <article
            key={task.id}
            onClick={(event) => {
              if (task.isAssignedToMe || (event.target instanceof Element && event.target.closest('button, input, select, a'))) return
              setSelectedTaskIds((current) => current.includes(task.id)
                ? current.filter((id) => id !== task.id)
                : [...current, task.id])
            }}
            className={`group ${task.isAssignedToMe ? 'cursor-default' : 'cursor-pointer'} rounded-2xl border p-4 shadow-sm transition-colors ${selectedTaskIds.includes(task.id)
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : task.status === 'completed'
                ? 'border-base-300/70 bg-base-100 opacity-75'
                : 'border-base-300/80 bg-base-100 hover:border-primary/40'}`}
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:flex">
              <input
                type="checkbox"
                className={`checkbox checkbox-primary checkbox-sm mt-1 ${selectedTaskIds.includes(task.id) ? '' : 'invisible pointer-events-none'}`}
                checked={selectedTaskIds.includes(task.id)}
                disabled={busy || task.isAssignedToMe}
                tabIndex={selectedTaskIds.includes(task.id) ? 0 : -1}
                onChange={(event) => setSelectedTaskIds((current) => (
                  event.target.checked
                    ? [...current, task.id]
                    : current.filter((id) => id !== task.id)
                ))}
                aria-label={`选择任务：${task.title}`}
              />
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className={`font-medium ${task.status === 'completed' ? 'text-base-content/55' : ''}`}>{task.title}</h2>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs ${
                        task.status === 'in_progress'
                          ? 'text-info'
                          : task.status === 'paused'
                            ? 'text-warning'
                          : task.status === 'completed'
                            ? 'text-base-content/45'
                            : 'text-base-content/55'
                      }`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        task.status === 'in_progress' ? 'bg-info' : task.status === 'paused' ? 'bg-warning' : task.status === 'completed' ? 'bg-base-content/35' : 'bg-base-content/25'
                      }`} aria-hidden="true" />
                      {statusLabels[task.status]}
                    </span>
                  </div>
                  {task.description ? <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-base-content/65">{task.description}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/50">
                    <span>{priorityLabels[task.priority]}优先级</span>
                    {task.assignedUserName ? <span>负责人：{task.assignedUserName}</span> : null}
                    {task.isAssignedToMe ? <span className="rounded bg-info/10 px-1.5 py-0.5 text-info">分配给我 · 只读</span> : null}
                    {task.dueDate ? <span className={task.status !== 'completed' && task.dueDate < new Date().toISOString().slice(0, 10) ? 'text-error' : ''}>截止 {task.dueDate}</span> : null}
                    {task.sourceConversationId && task.sourceMessageId ? (
                      <Link
                        to={`/ai-chat?conversationId=${encodeURIComponent(task.sourceConversationId)}&messageId=${encodeURIComponent(task.sourceMessageId)}`}
                        className="text-primary hover:underline"
                      >
                        查看 AI 来源
                      </Link>
                    ) : null}
                    <span>更新于 {formatDate(task.updatedAt)}</span>
                  </div>
                </div>
                {task.images?.length ? (
                  <div className="flex w-52 max-w-full shrink-0 flex-wrap justify-end gap-2 sm:w-104">
                    {task.images.map((image) => (
                      <div key={image.id} className="h-20 w-24 overflow-hidden rounded-lg border border-base-300 bg-base-200">
                        <TaskImagePreview image={image} onPreview={() => setPreviewTarget({ image })} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className={`col-start-2 flex items-center justify-end gap-1 sm:ml-auto ${selectedTaskIds.includes(task.id) ? '' : 'invisible pointer-events-none group-hover:visible group-hover:pointer-events-auto'}`}>
                {!task.isAssignedToMe ? (
                  <>
                    <RowMenuTrigger
                      open={openMenuId === `task-${task.id}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        rowMenu.toggle(`task-${task.id}`, event.currentTarget)
                      }}
                      label={`${task.title}操作`}
                    />
                    {openMenuId === `task-${task.id}` && menuAnchor ? (
                  <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
                    {Object.entries(statusLabels).map(([value, label]) => {
                      const status = value as TaskStatus
                      const current = task.status === status
                      return (
                        <MenuAction
                          key={status}
                          icon={current ? menuIcons.check : <span className="w-4" />}
                          label={current ? `${label}（当前）` : `设为${label}`}
                          active={current}
                          onClick={() => {
                            closeRowMenu()
                            if (!current) void changeStatus(task, status)
                          }}
                        />
                      )
                    })}
                    <div className="my-1 border-t border-base-200" />
                    <MenuAction
                      icon={menuIcons.edit}
                      label="编辑任务"
                      onClick={() => { closeRowMenu(); openEdit(task) }}
                    />
                    <MenuAction
                      icon={menuIcons.trash}
                      label="删除任务"
                      tone="danger"
                      onClick={() => { closeRowMenu(); setDeleteTask(task) }}
                    />
                  </RowMenuPopover>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

        </div>
      {!loading && tasks.length > 0 ? (
        <div className="sticky bottom-0 z-10 flex h-14 min-h-14 shrink-0 items-center gap-2 overflow-hidden border-t border-base-200 bg-base-100 px-3 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap sm:gap-3">
            {selectableTasks.length ? (
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
                <input
                  ref={selectPageRef}
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm"
                  checked={allPageSelected}
                  disabled={busy}
                  onChange={(event) => togglePageSelection(event.target.checked)}
                  aria-label="全选"
                />
                全选
              </label>
            ) : null}
            {selectedTaskIds.length > 0 ? (
              <>
                <span className="shrink-0 text-sm text-base-content/60">已选 {selectedTaskIds.length} 项</span>
                <select
                  defaultValue=""
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value) void changeSelectedStatus(event.target.value as TaskStatus)
                    event.target.value = ''
                  }}
                  className="select select-bordered select-sm shrink-0"
                  aria-label="批量设置任务状态"
                >
                  <option value="">批量处理状态</option>
                  {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button type="button" className="btn btn-error btn-sm shrink-0" disabled={busy} onClick={() => { setError(''); setDeleteSelected(true) }}>
                  批量删除
                </button>
                <button type="button" className="btn btn-ghost btn-sm shrink-0" disabled={busy} onClick={() => setSelectedTaskIds([])}>
                  取消选择
                </button>
              </>
            ) : null}
          </div>
          {!loading && totalPages > 1 ? (
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => { setSelectedTaskIds([]); setLoading(true); setPage((current) => current - 1) }}>上一页</button>
              <span className="text-sm text-base-content/55">{page} / {totalPages}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => { setSelectedTaskIds([]); setLoading(true); setPage((current) => current + 1) }}>下一页</button>
            </div>
          ) : null}
        </div>
      ) : null}
      </section>
      </div>

      {editingTask ? (
        <TaskFormDialog
          open={Boolean(editingTask)}
          editing
          form={form}
          setForm={setForm}
          busy={busy}
          error={error}
          projects={projects}
          assignees={assignees}
          isAdmin={isAdmin}
          onPreviewImage={(target) => setPreviewTarget(target)}
          onClose={() => { if (!busy) { setEditingTask(null); setError('') } }}
          onSave={() => void saveTask()}
        />
      ) : null}
      {deleteTask ? (
        <Dialog onClose={() => !busy && setDeleteTask(null)}>
          <DialogHeader title="删除任务" subtitle={`确定删除“${deleteTask.title}”？此操作无法撤销。`} onClose={() => !busy && setDeleteTask(null)} />
          <DialogError>{error}</DialogError>
          <DialogActions>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteTask(null)} disabled={busy}>取消</button>
            <button type="button" className="btn btn-error" onClick={() => void confirmDelete()} disabled={busy}>{busy ? '删除中…' : '删除任务'}</button>
          </DialogActions>
        </Dialog>
      ) : null}
      {deleteSelected ? (
        <Dialog onClose={() => !busy && setDeleteSelected(false)}>
          <DialogHeader
            title="批量删除任务"
            subtitle={`确定删除选中的 ${selectedTaskIds.length} 项任务？此操作无法撤销。`}
            onClose={() => !busy && setDeleteSelected(false)}
          />
          <DialogError>{error}</DialogError>
          <DialogActions>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteSelected(false)} disabled={busy}>取消</button>
            <button type="button" className="btn btn-error" onClick={() => void confirmDeleteSelected()} disabled={busy || selectedTaskIds.length === 0}>{busy ? '删除中…' : '删除任务'}</button>
          </DialogActions>
        </Dialog>
      ) : null}
      {projectDialog ? (
        <Dialog onClose={() => !busy && setProjectDialog(null)} width="sm">
          <DialogHeader
            title={projectDialog.id === null ? '新建项目' : '重命名项目'}
            onClose={() => !busy && setProjectDialog(null)}
          />
          <DialogField label="项目名称" required>
            <input
              autoFocus
              maxLength={50}
              value={projectDialog.name}
              onChange={(event) => setProjectDialog((current) => current ? { ...current, name: event.target.value } : current)}
              className="input input-bordered mt-1.5 w-full"
            />
          </DialogField>
          <DialogError>{error}</DialogError>
          <DialogActions>
            <button type="button" className="btn btn-ghost" onClick={() => setProjectDialog(null)} disabled={busy}>取消</button>
            <button type="button" className="btn btn-primary" onClick={() => void saveProject()} disabled={busy || !projectDialog.name.trim()}>{busy ? '保存中…' : '保存'}</button>
          </DialogActions>
        </Dialog>
      ) : null}
      {deleteProject ? (
        <Dialog onClose={() => !busy && setDeleteProject(null)}>
          <DialogHeader
            title="删除项目"
            subtitle={`确定删除“${deleteProject.name}”？其中 ${deleteProject.taskCount} 项任务会保留并移至“未分类”。`}
            onClose={() => !busy && setDeleteProject(null)}
          />
          <DialogError>{error}</DialogError>
          <DialogActions>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteProject(null)} disabled={busy}>取消</button>
            <button type="button" className="btn btn-error" onClick={() => void confirmDeleteProject()} disabled={busy}>{busy ? '删除中…' : '删除项目'}</button>
          </DialogActions>
        </Dialog>
      ) : null}
      {previewTarget ? (
        <TaskImageLightbox
          key={previewTarget.image?.id || `${previewTarget.file?.name}-${previewTarget.file?.lastModified}`}
          {...previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      ) : null}

      <TaskFormDialog
        open={creatingTask}
        editing={false}
        form={form}
        setForm={setForm}
        busy={busy}
        error={error}
        projects={projects}
        assignees={assignees}
        isAdmin={isAdmin}
        onPreviewImage={(target) => setPreviewTarget(target)}
        onClose={() => { if (!busy) { setCreatingTask(false); setForm({ ...emptyForm }); setError('') } }}
        onSave={() => void saveTask()}
      />
    </div>
  )
}

function renderTaskForm(
  form: TaskForm,
  setForm: Dispatch<SetStateAction<TaskForm>>,
  busy: boolean,
  projects: TaskProject[],
  assignees: TaskAssignee[],
  isAdmin: boolean,
  onPreviewImage: (target: { image?: TaskImage; file?: File }) => void,
) {
  return (
    <div className="mt-2">
      <DialogField label="任务标题" required>
        <input autoFocus maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="input input-bordered mt-1.5 w-full" />
      </DialogField>
      <DialogField label="任务说明">
        <textarea maxLength={5000} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="textarea textarea-bordered mt-1.5 w-full" />
      </DialogField>
      <DialogField label="任务图片">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          disabled={busy}
          className="file-input file-input-bordered mt-1.5 w-full"
          onChange={(event) => {
            const selected = Array.from(event.target.files || [])
            event.target.value = ''
            setForm((current) => {
              const invalidType = selected.some((file) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
              const oversized = selected.some((file) => file.size > 5 * 1024 * 1024)
              const tooMany = current.images.length + current.imageFiles.length + selected.length > 8
              const validFiles = selected.filter((file) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) && file.size <= 5 * 1024 * 1024)
              return {
                ...current,
                imageFiles: tooMany ? current.imageFiles : [...current.imageFiles, ...validFiles],
                imageError: tooMany
                  ? '每条任务最多添加 8 张图片。'
                  : oversized
                    ? '单张任务图片不能超过 5MB。'
                    : invalidType
                      ? '图片仅支持 PNG、JPEG、WebP 或 GIF 格式。'
                      : '',
              }
            })
          }}
        />
        <p className="mt-1 text-xs text-base-content/55">最多 8 张，支持 PNG、JPEG、WebP、GIF；单张不超过 5MB。</p>
        {form.images.length + form.imageFiles.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {form.images.map((image) => (
              <div key={image.id} className="relative h-20 w-24 overflow-hidden rounded-lg border border-base-300 bg-base-200">
                <TaskImagePreview image={image} onPreview={() => onPreviewImage({ image })} />
                <button
                  type="button"
                  className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-xs text-white"
                  disabled={busy}
                  onClick={() => setForm((current) => ({ ...current, images: current.images.filter((item) => item.id !== image.id), imageError: '' }))}
                >
                  移除
                </button>
              </div>
            ))}
            {form.imageFiles.map((file, index) => (
              <div key={`${index}-${file.name}-${file.lastModified}-${file.size}`} className="relative h-20 w-24 overflow-hidden rounded-lg border border-base-300 bg-base-200">
                <TaskImagePreview file={file} onPreview={() => onPreviewImage({ file })} />
                <button
                  type="button"
                  className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-xs text-white"
                  disabled={busy}
                  onClick={() => setForm((current) => ({ ...current, imageFiles: current.imageFiles.filter((item) => item !== file), imageError: '' }))}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {form.imageError ? <p className="mt-1 text-sm text-error">{form.imageError}</p> : null}
      </DialogField>
      <DialogField label="所属项目">
        <select
          value={form.projectId ?? ''}
          disabled={busy}
          onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value ? Number(event.target.value) : null }))}
          className="select select-bordered mt-1.5 w-full"
        >
          <option value="">未分类</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </DialogField>
      {isAdmin ? (
        <DialogField label="任务负责人">
          <select
            value={form.assignedUserId ?? ''}
            disabled={busy}
            onChange={(event) => {
              const assignedUserId = event.target.value ? Number(event.target.value) : null
              const assignee = assignees.find((user) => user.id === assignedUserId)
              setForm((current) => ({
                ...current,
                assignedUserId,
                assignedUserName: assignee?.name || '',
              }))
            }}
            className="select select-bordered mt-1.5 w-full"
          >
            <option value="">未指定</option>
            {form.assignedUserId !== null && !assignees.some((user) => user.id === form.assignedUserId) ? (
              <option value={form.assignedUserId}>{form.assignedUserName || `用户 ${form.assignedUserId}`}（已停用）</option>
            ) : null}
            {assignees.map((user) => <option key={user.id} value={user.id}>{user.name}（{user.username}）</option>)}
          </select>
        </DialogField>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <DialogField label="状态">
          <select value={form.status} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as TaskStatus }))} className="select select-bordered mt-1.5 w-full">
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </DialogField>
        <DialogField label="优先级">
          <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as TaskPriority }))} className="select select-bordered mt-1.5 w-full">
            {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </DialogField>
      </div>
      <DialogField label="截止日期">
        <input type="date" value={form.dueDate || ''} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value || null }))} className="input input-bordered mt-1.5 w-full" />
      </DialogField>
    </div>
  )
}

function TaskFormDialog({
  open,
  editing,
  form,
  setForm,
  busy,
  error,
  projects,
  assignees,
  isAdmin,
  onPreviewImage,
  onClose,
  onSave,
}: {
  open: boolean
  editing: boolean
  form: TaskForm
  setForm: Dispatch<SetStateAction<TaskForm>>
  busy: boolean
  error: string
  projects: TaskProject[]
  assignees: TaskAssignee[]
  isAdmin: boolean
  onPreviewImage: (target: { image?: TaskImage; file?: File }) => void
  onClose: () => void
  onSave: () => void
}) {
  if (!open) return null
  return (
    <Dialog onClose={onClose} width="md">
      <DialogHeader title={editing ? '编辑任务' : '新建任务'} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {renderTaskForm(form, setForm, busy, projects, assignees, isAdmin, onPreviewImage)}
      </div>
      <DialogError>{error}</DialogError>
      <DialogActions>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy || !form.title.trim()}>{busy ? '保存中…' : editing ? '保存修改' : '创建任务'}</button>
      </DialogActions>
    </Dialog>
  )
}
