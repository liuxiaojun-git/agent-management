// 应用入口 — 路由配置，定义所有页面路径与 Layout 布局
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { canAccess, firstAllowedPath, getStoredPermissions, type ModulePermission } from './utils/permissions'

const Home = lazy(() => import('./pages/Home'))
const ApiTest = lazy(() => import('./pages/ApiTest'))
const Logs = lazy(() => import('./pages/Logs'))
const Models = lazy(() => import('./pages/Models'))
const Knowledge = lazy(() => import('./pages/Knowledge'))
const KnowledgeDocument = lazy(() => import('./pages/Knowledge').then((module) => ({ default: module.KnowledgeDocument })))
const AiChatPage = lazy(() => import('./pages/AiChatPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const Users = lazy(() => import('./pages/Users'))

// 检查是否已登录
function isAuthenticated() {
  try {
    return !!(
      localStorage.getItem('user') &&
      localStorage.getItem('access_token')
    )
  } catch {
    return false
  }
}

// 需要登录才能访问的路由
function ProtectedRoute({ children, module }: { children: React.ReactNode; module?: ModulePermission }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  if (module && !canAccess(module)) {
    return <Navigate to={firstAllowedPath(getStoredPermissions())} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center">加载中…</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/knowledge/document" element={<ProtectedRoute><KnowledgeDocument /></ProtectedRoute>} />
          <Route element={<Layout />}>
            <Route
              index
              element={
                isAuthenticated()
                  ? <Navigate to={firstAllowedPath(getStoredPermissions())} replace />
                  : <Navigate to="/login" replace />
              }
            />
            <Route
              path="home"
              element={<ProtectedRoute module="home"><Home /></ProtectedRoute>}
            />
            <Route
              path="ai-chat"
              element={<ProtectedRoute module="knowledge"><AiChatPage /></ProtectedRoute>}
            />
            <Route
              path="knowledge"
              element={<ProtectedRoute><Knowledge /></ProtectedRoute>}
            />
            <Route
              path="api-test"
              element={<ProtectedRoute module="api_test"><ApiTest /></ProtectedRoute>}
            />
            <Route
              path="logs"
              element={<ProtectedRoute module="logs"><Logs /></ProtectedRoute>}
            />
            <Route
              path="models"
              element={<ProtectedRoute module="models"><Models /></ProtectedRoute>}
            />
            <Route
              path="users"
              element={<ProtectedRoute module="users"><Users /></ProtectedRoute>}
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
