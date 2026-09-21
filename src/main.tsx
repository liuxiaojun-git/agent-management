import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// 不使用 <StrictMode>：开发模式下它会故意把每个 effect 跑两遍（mount → cleanup → mount），
// 导致首页 dashboard 发 2 次请求、用户列表多一个「已取消」的请求、recharts 首帧 -1 警告刷屏。
// 生产构建本来就不会双调用，所以这里去掉只影响本地 dev 的观感，不影响任何运行时行为。
createRoot(document.getElementById('root')!).render(<App />)
