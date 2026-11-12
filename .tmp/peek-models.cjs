// 只读：看一眼 AI 问答当前实际可用的模型来自哪张表、配了什么。
const path = 'E:/zhiyu-backend/src/db'
const pool = require(path)
;(async () => {
  const [rows] = await pool.execute(
    'SELECT id, provider, endpoint, models, enabled, sort_order, (api_key IS NOT NULL AND api_key <> "") AS has_key FROM model_provider ORDER BY sort_order, id'
  )
  console.log(JSON.stringify(rows, null, 2))
  await pool.end()
})().catch((error) => { console.error(String(error).split('\n')[0]); process.exit(1) })
