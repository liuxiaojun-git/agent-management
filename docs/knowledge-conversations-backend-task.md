# 后端任务：知识库问答记录持久化到 MySQL

> 给外部后端（端口 3000 的 `/api/knowledge` 链路，Express + MySQL）的实现任务书。
> 数据契约与前端对接细节见 [knowledge-conversations-api.md](./knowledge-conversations-api.md)；本文件是后端可执行的任务清单。

## 一、目标

前端每次问答/会话变更后，调用后端把问答记录保存到 MySQL；页面加载时读回。**前端已完成对接，后端只需实现 2 个端点**。

## 二、需要实现的端点

### 1. `GET /api/knowledge/conversations`

读取当前用户全部问答记录，按作用域分组。

- 鉴权：`Authorization: Bearer <access_token>`（与现有 `/api/knowledge/ask` 一致，复用登录态）。
- 成功响应：`200 { "success": true, "data": { "library:1": [...], "collection:personal": [] } }`；无记录时 `data: {}`。
- 数组顺序：**最新在前**（前端把第一条当活跃会话）。
- 失败响应：非 `200` + JSON，如 `{ "success": false, "error": "..." }`。

### 2. `POST /api/knowledge/conversations`

全量替换（replace-all）当前用户全部问答记录。

- 请求体：`{ "conversations": { "library:1": [...], "collection:personal": [...] } }`。
- 语义：前端每次携带**跨所有作用域的完整快照**，不是增量。后端应在**同一事务**内先删除当前用户全部记录，再批量插入本次传入的会话（或按 `id` upsert + 删除不在本次数据中的行），使表内容与传入 map 完全一致。
- 成功响应：`200 { "success": true }`。

## 三、数据结构（与前端 `Knowledge.tsx` 完全一致）

```ts
Citation      = { id: number, title: string, path?: string, updated?: string }
ChatMessage   = { role: 'user' | 'assistant', text: string, citations?: Citation[], createdAt?: string }
Conversation  = { id: string(uuid), title: string, messages: ChatMessage[], createdAt: string, updatedAt: string }  // 时间均为 ISO 8601

// scopeKey（作用域标识，会话归属）：
//   'library:<id>'              如 library:1
//   'collection:<key>'          如 collection:personal
//   'folder:<libraryId>:<路径>'  如 folder:1:产品规划/需求文档
```

`messages` 字段直接存取完整 JSON 数组，**后端不做结构解析**，原样读写。

## 四、MySQL 表

```sql
CREATE TABLE IF NOT EXISTS knowledge_conversations (
  id          CHAR(36)     NOT NULL,                 -- 会话 uuid（主键）
  scope_key   VARCHAR(255) NOT NULL,                 -- library:1 / collection:personal / folder:1:产品规划
  title       VARCHAR(200) NOT NULL DEFAULT '',
  messages    JSON         NOT NULL,                 -- ChatMessage[] 数组，原样存取
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_scope_key (scope_key),
  KEY idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 五、实现要点

- **事务写法**（伪代码）：
  ```sql
  START TRANSACTION;
  DELETE FROM knowledge_conversations /* WHERE user_id = ? */;
  INSERT INTO knowledge_conversations (id, scope_key, title, messages, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?);   -- 逐条插入本次传入的会话
  COMMIT;
  ```
- **用户隔离**：默认与现有 `knowledge-workspace` 一致，**单租户共享、不做用户隔离**。若部署为多租户，再增加 `user_id` 列并按当前登录用户过滤（读写两端都要）。
- **响应格式规范**：两个端点都返回规范 JSON；失败用非 `200` + `{ "success": false, "error": "..." }`。**绝不能对未知路径回 `200 + index.html`** —— 前端依赖响应体 `payload.success === true` 判断成功，格式不对会导致前端把保存判定为失败。前端已做静默降级兜底（问答照常、记录仅存内存），不会崩，但会丢掉持久化效果。
- 两个端点都挂在现有 Express 鉴权中间件之后，复用登录态。

## 六、验收标准

| 场景 | 预期 |
|---|---|
| 未登录调用 GET/POST | 返回 `401` |
| 登录后 GET | 返回当前用户全部会话，按 scopeKey 分组，最新在前；无记录 `data: {}` |
| 登录后 POST 全量快照 | `200 { success: true }`；事务内完成替换，表内容与传入 map 完全一致 |
| 前端提问后 | 触发 `POST /api/knowledge/conversations`（用户消息入列 + 回答回填各一次），记录落库 |
| 前端刷新页面 | 历史会话从 `GET` 读回，Q&A 记录不丢失 |

## 七、前后端联调

- 前端已就绪，后端实现后**前端无需改动**。
- 开发联调用 `admin / admin@123` 登录拿 token（`POST /api/auth/login`）。
- 数据契约变更时先改 [knowledge-conversations-api.md](./knowledge-conversations-api.md)，再同步前端 `src/utils/api.ts` / `src/pages/Knowledge.tsx`。
