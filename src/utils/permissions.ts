export type ModulePermission = 'home' | 'knowledge' | 'api_test' | 'logs' | 'models' | 'users'

export const modulePaths: Record<ModulePermission, string> = {
  home: '/home',
  knowledge: '/knowledge',
  api_test: '/api-test',
  logs: '/logs',
  models: '/models',
  users: '/users',
}

export function firstAllowedPath(permissions?: ModulePermission[]) {
  const first = permissions?.find((permission) => modulePaths[permission])
  return first ? modulePaths[first] : '/login'
}

export function getStoredPermissions(): ModulePermission[] {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    return Array.isArray(user?.permissions) ? user.permissions : []
  } catch {
    return []
  }
}

export function canAccess(module: ModulePermission) {
  return getStoredPermissions().includes(module)
}
