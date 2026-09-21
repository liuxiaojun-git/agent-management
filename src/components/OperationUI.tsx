// 页面里「操作」的统一外观：⋯ 浮层菜单、确认/表单弹窗、图标。
//
// 抽成独立文件是因为知识库与 AI 问答两个页面要用同一套。此前每个页面各写各的：同样是「删除」，
// 知识库是 ⋯ 菜单里的红字项，AI 问答是卡片右上角一个 ✕ 字号还更小；同样是确认删除，
// 一个带标题图标和右上角关闭，一个连删的是哪条都不说。放在这里改一次，两个页面一起动。
//
// 图标集、浮层落点计算、菜单状态机在 operationMenu.tsx —— 分成两份是 react-refresh 的要求
// （一个模块要么只导出组件、要么不导出组件），类型用 import type 引回来，运行时不构成环。

import type { RowMenuAnchor } from './operationMenu'

// —— 图标 ——
// 全站一套线性图标（24 格、1.8 描边）。默认 16px，需要更大或更小时用 className 覆盖。
export const Icon = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <svg className={`h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

// —— 弹窗 ——
export const Dialog = ({ onClose, width = 'sm', children }: { onClose: () => void; width?: 'sm' | 'md' | '2xl'; children: React.ReactNode }) => (
  <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}
      className={`flex max-h-[85vh] w-full flex-col rounded-2xl bg-base-100 p-6 shadow-2xl ${width === '2xl' ? 'max-w-2xl' : width === 'md' ? 'max-w-md' : 'max-w-sm'}`}>
      {children}
    </div>
  </div>
)

// 标题行：可选前置图标（删除类传红色的）+ 可选副标题 + 可选就地动作 + 右上角关闭。
// 关闭按钮统一收在这里：此前页面里只有少数几个弹窗带 X，是最扎眼的一处不一致。
// 副标题默认换行不截断（删除确认是一整句话）；要显示长地址的弹窗自己传一个 truncate 的 span。
// actions 是给「弹窗里除了关闭还有一个动作」用的（API 测试的并发结果详情要复制 Body）：正文是可滚动的
// 长文本，动作用户往往一打开就要按，塞进底部按钮区就得先滚到底。多数弹窗不传，按钮区仍在底部。
export const DialogHeader = ({ title, subtitle, icon, actions, onClose }: { title: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; onClose: () => void }) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">
      <h3 className="flex items-center gap-2 text-lg font-semibold">{icon}{title}</h3>
      {subtitle ? <div className="mt-1 text-sm text-base-content/45">{subtitle}</div> : null}
    </div>
    {actions ? <div className="-mt-1 flex shrink-0 items-center gap-2">{actions}</div> : null}
    <button onClick={onClose} className="-mr-2 -mt-1 btn btn-ghost btn-square btn-sm shrink-0" aria-label="关闭"><Icon><path d="M18 6 6 18M6 6l12 12" /></Icon></button>
  </div>
)

// 表单字段：标签包住控件，点标签即聚焦，不必给每个弹窗编 id。
export const DialogField = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <label className="mt-4 block"><span className="text-xs font-medium text-base-content/60">{label}{required ? <span className="text-error"> *</span> : null}</span>{children}</label>
)

// 就地报错，不用 window.alert：弹窗还开着、用户改一个字就能重试，不该被一个系统框打断。
export const DialogError = ({ children }: { children: React.ReactNode }) => children ? <p className="mt-2 text-xs leading-5 text-error" role="alert">{children}</p> : null

export const DialogActions = ({ children }: { children: React.ReactNode }) => <div className="mt-6 flex justify-end gap-2">{children}</div>

// —— ⋯ 菜单 ——
// 触发器。onClick 收下整个事件而不是无参回调，是因为浮层要按触发器的实测矩形定位。
export const RowMenuTrigger = ({ open, onClick, label }: { open: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; label: string }) => (
  <button onClick={onClick} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={label}
    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-base-300/70 ${open ? 'bg-base-300/70 text-base-content' : 'text-base-content/30 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
    <Icon><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></Icon>
  </button>
)

// 面板：⋯ 菜单与工具条浮层（排序、添加内容）共用同一宽度、描边、阴影和内边距。
// 面板本身不管定位，由外层容器决定，所以两种浮层看起来是同一个东西。
export const MenuPanel = ({ children }: { children: React.ReactNode }) => (
  <div className="w-44 rounded-lg border border-base-200 bg-base-100 p-1.5 shadow-xl">{children}</div>
)

// 浮层的定位容器。坐标是触发器的视口矩形，用 fixed 而不是 absolute——行都躺在 overflow-y-auto 的
// 列表里，absolute 会被滚动容器裁掉，最后一行（往往正是刚添加的那条）最明显。fixed 只要祖先没有
// transform 就不受裁剪。
// onClick 是可选的：行本身可点击时（API 测试的请求行点了就加载），浮层虽然飘在外面、DOM 上仍是行的
// 子节点，点菜单项会一路冒泡上去把行也点了。调用方传 stopPropagation 挡住。
export const RowMenuPopover = ({ anchor, panelRef, onClick, children }: { anchor: RowMenuAnchor; panelRef: React.RefObject<HTMLDivElement | null>; onClick?: (event: React.MouseEvent<HTMLDivElement>) => void; children: React.ReactNode }) => (
  <div
    ref={panelRef}
    role="menu"
    onClick={onClick}
    className="fixed z-60"
    // 面板右缘对齐触发器右缘，向左下方展开。用 bottom 定位时面板高度不必事先知道。
    style={anchor.top != null ? { top: anchor.top, right: anchor.right } : { bottom: anchor.bottom, right: anchor.right }}
  >
    <MenuPanel>{children}</MenuPanel>
  </div>
)

// 菜单项一律撑满面板宽度：按钮若按内容宽度收缩，悬停高亮就只有「图标+文字」那一小截，
// 同一个菜单里「删除」比「移动到」短一截、高亮也跟着短一截，看起来像没对齐。
export const MenuAction = ({ icon, label, tone = 'default', active = false, onClick }: {
  icon: React.ReactNode; label: string; tone?: 'default' | 'primary' | 'danger'; active?: boolean; onClick: () => void
}) => (
  <button role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition ${tone === 'danger' ? 'text-error hover:bg-error/10' : tone === 'primary' ? 'text-base-content/75 hover:bg-primary/10 hover:text-primary' : 'text-base-content/75 hover:bg-base-200'} ${active ? 'bg-success/10 text-success hover:bg-success/10' : ''}`}>
    {icon}<span className="whitespace-nowrap">{label}</span>
  </button>
)
