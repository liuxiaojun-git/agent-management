# 后端改动记录：知识库内容跨知识库移动

> 对应前端 `src/pages/Knowledge.tsx` 的「移动到」——目标位置从「当前知识库内的文件夹」扩展到**整个知识库架构**（所有知识库的根目录与全部文件夹）。
> 与 [knowledge-conversations-backend-task.md](./knowledge-conversations-backend-task.md) 不同，本次**后端改动已完成**，本文件是改动记录与部署说明。

## 一、为什么必须改后端

前端早先把「移动到」限制在当前知识库内，不是产品取舍，而是后端同步逻辑挡住的：

- `knowledge_content.content_key` 上有**全局唯一**索引 `uk_knowledge_content_key`（不含 `library_id`）；
- 工作区保存按知识库逐个处理，每个库内部是「**按 `content_key` upsert 收到的条目 → 删掉库里没收到的条目**」。

于是把一条内容从 A 库挪到 B 库时：

| 处理顺序 | 旧逻辑的结果 |
| --- | --- |
| A 在前 | A 删掉该行 → B 插入 → **正常** |
| B 在前 | B 按库查不到 existing → INSERT → 撞 `uk_knowledge_content_key` → **整个事务回滚，保存失败** |

两个库的先后由客户端给的知识库数组顺序决定，也就是说**是否保存成功取决于运气**。前端把目标写进 payload 是不够的，必须让后端认得出「这是移动」。

## 二、后端代码改动（`src/routes/data.js`）

`setKnowledgeWorkspace` 内三处：

### 1. 知识库行先全部落定，再处理内容（两段式）

原先是「插一个库 → 立刻同步这个库的内容」。

`knowledge_content.library_id` 上有外键 `fk_knowledge_content_library` 指向 `knowledge_library`。跨库移动要把内容的 `library_id` 改成另一个库的 id，如果目标库排在后面且是**本次新建**的，边插库边改内容就会撞上「目标库尚不存在」的外键错误。

改法：第一轮只 upsert 全部 `knowledge_library` 行并记下 `oldId → libraryId`，第二轮再按这个映射同步各库内容。

### 2. 建立 `content_key` 归属表，把跨库移动识别成 `UPDATE library_id`

事务内先拉一次本用户全部库下的 `(id, content_key, library_id, parent_path)` 到 `ownerByKey`，然后在写入循环里：

```js
const existing = existingByKey.get(key);   // 按当前库查
if (!existing) {
  const owner = ownerByKey.get(key);       // 按全用户查
  if (owner && Number(owner.library_id) !== libraryId) {
    // 跨库移动：改 library_id，而不是删了重插
    UPDATE knowledge_content SET library_id = ?, parent_path = ?, name = ?, content_type = ?,
        url = ?, item_count = ?, sort_order = ?, content_updated_at = ..., updated_at = ...
    WHERE id = ?
    continue;
  }
  INSERT ...
}
```

两个关键性质：

- **行 id 不变**，所以 `knowledge_content_asset`（按 `content_id` 挂）原地跟着走，**字节不必搬运**；
- 两种处理顺序都收敛到同一结果：源库在前 → 删 + 插（老路径）；目标库在前 → `UPDATE library_id`，源库那一轮随后既查不到、也不会再删。

### 3. 增删两处必须同步 `ownerByKey`

这一处**最容易漏，且漏了是静默丢数据**：

- 删除循环里删掉一行后要 `ownerByKey.delete(content_key)`。留着已删行的记录，后面某个库若把同一个 key 收进来，就会走「跨库移动」分支去 `UPDATE` 一个不存在的 id——**影响 0 行，内容无声消失**。
- 跨库移动的 `UPDATE` 前要先取出旧的 `library_id` 与 `parent_path`（改完就找不回去了），用于给**源库**的目录补记 `updated_at`。

### 4. 目录 `updated_at` 改为全局收集、最后统一刷新

原先 `touchedFolders` 是每个库一份、当轮刷完。跨库移动时源库那一轮已经跑完、看不见被搬走的行，源库的几个目录就漏刷新了。改为 `Map<libraryId, Set<path>>` 全局收集，两个库的循环走完后统一刷一遍。

## 三、数据库

**无需迁移**：不新增列、不新增索引，用的是已有的 `uk_knowledge_content_key` 与 `fk_knowledge_content_library`。

## 四、前端契约

`moveDestinations` 现在返回按库分组的 `MoveGroup[]`，目标位置带上库 id：

```ts
type MoveTarget = { libraryId: number; path: string | null }   // path 为 null 表示该库根目录
type MoveOption = MoveTarget & { label: string; disabled: boolean; reason?: string }
type MoveGroup = { libraryId: number; libraryName: string; isCurrent: boolean; options: MoveOption[] }
```

`relocateContent` 增加第 4 个参数 `targetLibraryId`，与 `activeId` 不同即为跨库：条目连同后代从源库数组整体挪到目标库数组，连带改写**文件夹会话键**（`folder:<库id>:<路径>`，键里含库 id）、逐条迁移**文档问答记录**（键含 `library_id`）、重算**两个库的条目数**。

## 五、验证要点

1. 把 A 库的一个文档移到 B 库的某个文件夹 → 刷新页面，条目出现在 B 库，A 库不再有；
2. 把 A 库的一个**文件夹**（内有子文件夹和文档）移到 B 库 → 整棵子树跟着走，层级不变；
3. 移动带字节的文档（pdf/图片）后打开它 → 内容仍能读出来（说明资产行跟着 content 行走，没有丢字节）；
4. 连续快速移动几条（让保存请求叠加）→ 不出现「保存失败」；
5. 目标库根目录或某个文件夹下已有同名条目 → 该目标在弹窗里是灰的，标「已有同名内容」。
