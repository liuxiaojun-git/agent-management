# 后端改动记录：知识库「网页链接」条目

> 对应前端 `src/pages/Knowledge.tsx` 的「添加内容 → 网页链接」。
> 与 [knowledge-conversations-backend-task.md](./knowledge-conversations-backend-task.md) 不同，本次**后端改动已完成**，本文件是改动记录与部署说明。

## 一、功能语义

「网页链接」是知识库里的一种**只存地址、不存字节**的条目：

- 不抓取、不解析网页内容，用户填什么地址就存什么地址；
- 列表里显示为普通条目，点击直接在**新标签页打开该外链**，不进入文档预览页；
- 没有 `knowledge_content_asset` 行，`hasAsset` / `mimeType` / `size` 均无；
- **不参与 AI 问答召回**（正文取不出来，进召回只会得到一条空参考资料）。

条目的 `content_type` 仍是 `doc`，靠 `url` 是否为 NULL 与普通文档区分。

## 二、数据库

新增迁移 `sql/021_knowledge_content_url.sql`：

```sql
ALTER TABLE knowledge_content
  ADD COLUMN url VARCHAR(2048) DEFAULT NULL AFTER content_type;
```

不建索引：地址只随条目整体读写，从不作为查询条件。

**每个环境都需要执行一次**：

```bash
node scripts/migrate-knowledge-content-url.js
```

## 三、后端代码改动（`src/routes/data.js`）

`knowledge-workspace` 的读写路径都是显式列，不做未知字段直通，因此 `url` 必须在每一处显式带上：

| 位置 | 改动 |
| --- | --- |
| 工作区读路径 SELECT | 加 `c.url` |
| 工作区读路径条目映射 | 加 `...(row.url ? { url: row.url } : {})` |
| `existingContents` SELECT | 加 `c.url` |
| 写入循环 | 加 `contentUrl`（空串归一成 NULL，并截断到 2048） |
| INSERT | 加 `url` 列与参数 |
| `metadataChanged` | 加 `(existing.url ?? null) !== contentUrl` |
| UPDATE | 加 `url = ?` 与参数 |

其中 `metadataChanged` 那一处**最容易漏**：漏掉它，客户端修改链接地址会被判成「无变化」直接 `continue`，改动静默丢失。

## 四、后端代码改动（`src/routes/knowledge.js`）

`/api/knowledge/ask` 的召回查询加 `AND c.url IS NULL`：

```sql
... WHERE c.library_id = ? AND c.content_type <> 'folder' AND c.url IS NULL
```

两处都要加：`libraryScope` 的基础条件，以及会**整体覆盖**该条件的 `collectionScope` 分支（`documentScope` / `folderScope` 是在基础上追加，自动继承）。

不改这里的话，外链条目会通过 `buildReferences` 里 `if (text || row.name)` 的 `row.name` 判真而进入召回集——正文为空、标题是域名，白占 8 个召回名额里的一个。

## 五、前端契约

```ts
// ContentItem 新增字段
url?: string   // 仅「网页链接」条目存在，http/https 绝对地址
```

前端在 `serializeContentItem` 白名单里放行 `url`；地址在写入前用 `new URL()` 校验并补全协议头，只接受 `http:` / `https:`。

## 六、验证要点

1. 添加一个网页链接 → 刷新页面（重新 GET 工作区）→ 条目的 `url` 仍在；
2. 点击该条目 → 新标签页打开该地址，而不是进文档预览页；
3. 同名域名添加两个不同页面 → 两条独立存在（`content_key` 是客户端 UUID，不从 name 推导，不会互相顶掉）；
4. 针对该知识库提问 → 参考资料里**不出现**外链条目。
