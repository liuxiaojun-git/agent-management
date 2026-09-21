import type { SavedFolder, SavedRequest } from './requestStore'

// 接口信息的层级与知识库同构：靠一个 parent 路径串把树拍平在一个数组里。
// 这里只放纯函数，不碰 React 也不碰持久化——树运算同时被侧栏、保存弹窗、移动弹窗和拖拽处理器用到。

/** parent 的空值归一化。所有比较都先过这一道，否则 undefined 和 null 会被当成两回事。 */
export const normParent = (parent?: string | null): string | null => parent || null

/** 文件夹自身的完整路径，相对所属集合。根层的父路径是 undefined/null。 */
export const folderPath = (folder: { parent?: string; name: string }): string =>
  folder.parent ? `${folder.parent}/${folder.name}` : folder.name

/** folderPath 的逆运算：路径的上一级。根层（没有斜杠）返回 null。 */
export const parentPathOf = (path: string | null): string | null => {
  if (!path) return null
  const slash = path.lastIndexOf('/')
  return slash < 0 ? null : path.slice(0, slash)
}

/** 路径最后一段，也就是「当前这一层」的名字。 */
export const leafNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export const isSelfOrDescendant = (candidate: string | null, path: string): boolean =>
  candidate === path || (candidate?.startsWith(`${path}/`) ?? false)

/** 直接子文件夹，保持数组顺序——接口信息有手动排序（sort_order），按名字排会让每次拖拽都弹回去。 */
export const childFolders = (folders: SavedFolder[], collection: string, parent: string | null): SavedFolder[] =>
  folders.filter((folder) => folder.collection === collection && normParent(folder.parent) === parent)

export const childRequests = (requests: SavedRequest[], collection: string, parent: string | null): SavedRequest[] =>
  requests.filter((request) => request.collection === collection && normParent(request.parent) === parent)

/**
 * 整棵子树里的文件夹 id（**含** path 自己），用于删除整棵子树和统计子文件夹数。
 *
 * 按文件夹【自身路径】判，不是按 parent：按 parent 会把 path 上那个文件夹本身漏掉
 * （它自己的 parent 在子树外面），于是删除只剩一个空壳。
 */
export const folderIdsInSubtree = (folders: SavedFolder[], collection: string, path: string): string[] =>
  folders
    .filter((folder) => folder.collection === collection && isSelfOrDescendant(folderPath(folder), path))
    .map((folder) => folder.id)

/** 整棵子树里的请求，用于删除时统计与清理选中态。 */
export const requestsInSubtree = (requests: SavedRequest[], collection: string, path: string): SavedRequest[] =>
  requests.filter((request) => request.collection === collection && isSelfOrDescendant(normParent(request.parent), path))

/** 集合里的请求总数（含所有层级）。左栏靠它决定「打开哪个集合」，只数根层参考价值不高。 */
export const collectionRequestCount = (requests: SavedRequest[], collection: string): number =>
  requests.filter((request) => request.collection === collection).length

/** 某层的直接子项数，用于行尾的计数徽标。 */
export const childCount = (
  folders: SavedFolder[],
  requests: SavedRequest[],
  collection: string,
  parent: string | null,
): number => childFolders(folders, collection, parent).length + childRequests(requests, collection, parent).length

/**
 * 同级重名判断，全应用只此一处。
 * 文件夹和请求共用一个命名空间：移动到弹窗的右栏只列文件夹，两种类型混在一起时用户分不清。
 */
export const siblingNameTaken = (
  folders: SavedFolder[],
  requests: SavedRequest[],
  collection: string,
  parent: string | null,
  name: string,
  excludeId?: string | null,
): boolean => {
  const needle = name.trim().toLocaleLowerCase()
  return (
    childFolders(folders, collection, parent).some(
      (folder) => folder.id !== excludeId && folder.name.trim().toLocaleLowerCase() === needle,
    ) ||
    childRequests(requests, collection, parent).some(
      (request) => request.id !== excludeId && request.label.trim().toLocaleLowerCase() === needle,
    )
  )
}

/** 后端 parent_path 是 VARCHAR(2000)，这里留一半余量，超了就地报错而不是等 MySQL 静默截断。 */
export const MAX_PATH_LENGTH = 1000

/** 集合内全部文件夹路径，用于「移动到」的路径下拉。 */
export const collectionFolderPaths = (folders: SavedFolder[], collection: string): string[] =>
  folders.filter((folder) => folder.collection === collection).map(folderPath)

export interface Breadcrumb {
  label: string
  /** 根节点为 null。其余是点击后应跳到的完整路径。 */
  path: string | null
}

/**
 * 面包屑。根节点写作「全部内容」而不是集合名——集合名已经在左栏高亮着了，这里再写一遍是重复。
 * 与知识库内容浏览器同款（Knowledge.tsx 那行也是「全部内容 / …」）。
 */
export function browseBreadcrumb(path: string | null): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: '全部内容', path: null }]
  if (!path) return crumbs
  const parts = path.split('/')
  parts.forEach((part, index) => {
    crumbs.push({ label: part, path: parts.slice(0, index + 1).join('/') })
  })
  return crumbs
}
