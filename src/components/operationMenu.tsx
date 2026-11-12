// 「操作」的非组件部分：图标集、⋯ 浮层的落点计算、菜单开关的状态机。
//
// 和 OperationUI.tsx 分成两个文件不是洁癖：react-refresh 要求一个模块要么只导出组件、要么不导出组件，
// 混在一起会让这个被两个页面共用的文件每次改动都触发整页刷新。类型走 import type，运行时不构成环。
//
// 抽出来的原因：知识库与 AI 问答两个页面要用同一套。此前各写各的 —— 同样是「删除」，知识库是 ⋯ 菜单里
// 的红字项，AI 问答是卡片右上角一个 ✕ 还更小；同样是重命名，一个弹窗、一个 window.prompt。

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './OperationUI'

// 同一种操作在全站必须是同一个图形：重命名和修改资料都是那支笔，删除都是那个垃圾桶。
export const menuIcons = {
  edit: <Icon><path d="M13.5 6.5 17.5 10.5" /><path d="M4 20h4l11-11a2.83 2.83 0 0 0-4-4L4 16v4Z" /></Icon>,
  environment: <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></Icon>,
  move: <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 11v5m-2.5-2.5h5" /></Icon>,
  trash: <Icon><path d="M3 6h18M8 6V4h8v2M6 6v14h12V6" /></Icon>,
  check: <Icon><path d="m5 12 4 4L19 6" /></Icon>,
  copy: <Icon><rect x="8" y="3" width="12" height="13" rx="2.5" /><rect x="4" y="8" width="12" height="13" rx="2.5" /></Icon>,
  uploadFile: <Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M12 11v6m-2.5-2.5h5" /></Icon>,
  uploadFolder: <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 16v-5m-2 2 2-2 2 2" /></Icon>,
  link: <Icon><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" /></Icon>,
  folderPlus: <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3" /><path d="M3 7v12a2 2 0 0 0 2 2h7" /><path d="M18 14v7m-3.5-3.5h7" /></Icon>,
  save: <Icon><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></Icon>,
}

// 浮层的落点：到视口右缘、以及到顶边或底边的距离。top / bottom 二选一，由触发器在屏幕上的位置决定。
export type RowMenuAnchor = { top?: number; bottom?: number; right: number }

// 右缘对齐触发器的右缘、往下展开，于是面板整个落在「⋯ 的左下方」，窄侧栏里也不会顶出屏幕。
// 触发器已经贴到视口底部时改成向上翻（用 bottom 定位：菜单是两项还是三项只有渲染时才知道，
// 回头再算 top 就得先把面板高度量出来）。菜单最多三四项，预留 180px 足够，不必真去测高。
export const rowMenuAnchor = (rect: { top: number; bottom: number; right: number }, viewportWidth: number, viewportHeight: number): RowMenuAnchor => {
  const right = Math.max(8, viewportWidth - rect.right)
  return rect.bottom > viewportHeight - 180
    ? { bottom: viewportHeight - rect.top + 6, right }
    : { top: rect.bottom + 6, right }
}

// ⋯ 菜单的状态机：同一时刻只开一个（openMenuId 唯一），位置在打开那一刻算一次就定住。
// 浮层是 fixed 的、不跟着列表滚动，所以容器一滚就直接收掉，不存在需要跟着重算坐标的情况。
export const useRowMenu = () => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<RowMenuAnchor | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // 触发器单独记：浮层是 fixed 的、已经不在触发器里面了，判定「点的是不是自己」必须另算。
  const triggerRef = useRef<HTMLElement | null>(null)

  const close = useCallback(() => { setOpenMenuId(null); setMenuAnchor(null) }, [])

  const toggle = (key: string, trigger: HTMLElement) => {
    if (openMenuId === key) { close(); return }
    triggerRef.current = trigger
    setOpenMenuId(key)
    setMenuAnchor(rowMenuAnchor(trigger.getBoundingClientRect(), window.innerWidth, window.innerHeight))
  }

  useEffect(() => {
    if (!openMenuId) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      // 触发器本身要排除掉：pointerdown 先收、click 再开，不排除的话点同一个「⋯」会变成
      // 「收掉又打开」，永远关不上。
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const closeOnViewportChange = () => close()

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [openMenuId, close])

  return { openMenuId, menuAnchor, panelRef, toggle, close }
}
