# dsh-analytics

[English](README.md) | 中文

面向 DeepSeek Harness 的 Agent FinOps / token 分析：从会话事件采集用量写入本地 SQLite 账本，用时间感知的定价表（绝不硬编码进逻辑）计费，并通过服务、agent 工具与 JSON API 路由查询。

这是设计中的 v1 范围：**总览 + 会话下钻 + 成本引擎 + 缓存分析**，并按 dsh-plugin 生态的 bundle 打包方式发布（带 `dsh.bundle` 的 npm 包 → `cordis.patch.yml`）。

## 安装

```sh
dsh plugin --profile web add dsh-analytics
```

从 git 安装（需要 `prepare` 构建授权）：

```sh
dsh plugin --profile web add github:you/dsh-analytics#<sha>
```

从本地检出安装：

```sh
dsh plugin --profile web add /path/to/dsh-analytics
```

本地开发时挂载源码 overlay：

```sh
dsh --profile web --patch ./cordis.yml
```

## 配置

插件行的 `config`（形状见 [cordis.yml](cordis.yml)）：

| Key | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dbPath` | string | —（必填） | SQLite 数据库文件；缺失的目录会自动创建。 |
| `currency` | string | — | 摘要中优先排序的首选币种（每行自带币种）。 |
| `peakHours` | `[startHour, endHour][]` | `[[1,4],[6,10]]` | UTC 半开区间高峰窗口；其余小时为低谷。 |
| `pricing` | `PricingRow[]` | 随附 DeepSeek V4 表 | **替换**随附默认值的定价行。 |
| `pricingFile` | string（绝对路径） | — | `PricingRow[]` 的 JSON 文件；与 `pricing` 互斥。 |
| `budget.daily` | number | — | 以 `budget.currency` 计的每日支出上限（UTC 日）。 |
| `budget.monthly` | number | — | 每月上限；总览还会预测月末支出。 |
| `budget.currency` | string | `currency` 或 `USD` | 限额计量币种。 |
| `tools` | boolean | `true` | 注册 `analytics_query` agent 工具。 |
| `web` | boolean | `true` | 在存在 `ctx.webServer` 时注册 `/api/analytics/*` JSON 路由。 |

## 定价：表是数据，不是代码

成本通过把每个请求与定价行匹配来计算：

```ts
interface PricingRow {
  provider: string          // request/header config provider
  model: string             // request/header config model
  region?: string           // optional discriminator
  priceType: 'peak' | 'off-peak' | 'flat'
  inputType: 'cache_hit' | 'cache_miss' | 'cache_write' | 'output'
  pricePerMillion: number   // per 1M tokens, in `currency`
  currency: string
  effectiveFrom: string     // ISO 8601, inclusive
  effectiveTo?: string      // ISO 8601, exclusive
}
```

匹配使用 `model + timestamp + cache hit/miss + input/output`，因此 T 时刻的请求始终按 T 时刻生效的行计费——之后改价永远不会改写历史。没有专用行时 `cache_write` 回退到 `cache_miss`。匹配行中 `effectiveFrom` 最新者胜出。

随附默认值遵循 DeepSeek V4 公告：`2026-08-16T16:00:00Z` 之前为统一费率，之后为高峰/低谷费率（低谷 = 高峰的 50%）。它们只是种子数据——提供 `pricing` 或 `pricingFile` 即可拥有整张表。无配置时仅在表为空时播种默认值，因此不带定价配置的重启绝不会覆盖已记录的价格。

## 采集内容

插件监听 `session/event`，并在启动时通过 `ctx.sessionQuery` 回放持久会话（未挂载该 seam 时仅实时）：

- `assistant/message` 用量 → 每个 (session, seq) 一行请求记录（去重、回放安全）
- `request/header` → provider / model / reasoning effort，用于定价
- `tool/call` + `tool/result` → 带错误标志的工具调用记录
- 会话头 → created-at、cwd、parent，用于分组

存储是本地 SQLite 数据库（`dsh_analytics_requests`、`dsh_analytics_tool_calls`、`dsh_analytics_sessions`、`dsh_analytics_pricing`）。数据不出本机；插件绝不调用 provider API。

## 服务：`ctx.analytics`

所有读取都是分离快照；服务绝不触碰会话存储或 agent loop：

```ts
await ctx.analytics.overview({ start, end })   // totals, cost, cache, reasoning, trend, byModel, bySession, budget
await ctx.analytics.session(sessionId)          // request rows, turn waterfall, tools, cache
await ctx.analytics.sessions({ start, end })    // per-session summaries
await ctx.analytics.models({ start, end })      // per-provider/model summaries
await ctx.analytics.tools({ start, end })       // per-tool calls/errors + step-attributed cost
await ctx.analytics.pricing()                   // the pricing table in force
await ctx.analytics.budget()                    // spend vs configured limits + projection
```

工具成本是**步骤级归因**：一次模型调用的成本在该步骤调用的所有工具间均摊，因此含多个工具的一步共享成本（绝不重复计算）。

## Agent 工具：`analytics_query`

模型可以查询同样的数字：

```text
analytics_query(query="overview", range_hours=24)
analytics_query(query="session", session_id="session-1")
analytics_query(query="models" | "sessions" | "tools" | "pricing" | "budget", range_hours=24)
```

`range_hours` 限制截止当前的时间窗口（`0` = 全部时间，默认 24）。

## Web API

挂载 `ctx.webServer` 时，只读 JSON 路由注册在 `/api/analytics/overview|sessions|models|tools|pricing|budget`（带可选 `?hours=` 查询参数）与 `/api/analytics/session/<sessionId>`。它们是未来仪表盘页面的数据源。

## 浏览器仪表盘

同样的路由驱动一个由插件在 `/analytics` 提供的自包含仪表盘（在浏览器打开 harness web 服务器 URL，或在挂载 `ctx.webServer` 的 headless profile 中打开 `http://127.0.0.1:<port>/analytics`）。它是打包在包内（`web/`）的零构建原生 JS 应用：

- **总览** — KPI 卡片（成本、token、缓存命中率、reasoning 占比）、token/成本趋势、构成、按模型成本、会话、预算
- **会话** — 带下钻的列表：轮次瀑布、累积上下文图、工具、缓存
- **Token 流 / 模型 / 成本 / 定价** — 分桶趋势、按模型聚合、按工具步骤归因、生效中的定价表

范围选择器（6h/24h/7d/30d/全部）作用于每个页面；harness 客户端内的 shell 导航集成是后续工作（harness 客户端目前没有空闲插件页槽）。

## 外壳内入口（web profile）

包还附带一个浏览器客户端 bundle（`dsh.client` → `exports["./client"]`，按 harness module-loader 契约构建）。在 web profile 中注册两个入口：

- 侧栏底部 Settings 旁的一个 **Token Analytics** 操作，打开全屏应用内面板，提供与 `/analytics` 相同的六个页面（Overview / Sessions / Token Flow / Models / Cost / Pricing，带范围选择器与刷新）；
- 会话头中的一个按会话 **Analytics** 操作，打开任务成本浮层（成本、token、缓存命中率、轮次瀑布、工具归因，以及完整仪表盘链接）。

两者读取同一组只读 JSON 路由，因此需要挂载插件的 host 侧（及其 web 路由）。无需 harness 客户端 shell 变更：侧栏入口使用 shell 现有的 `sidebar.footer.action` 槽位。

## 开发

```sh
pnpm install
pnpm test
pnpm lint
pnpm build
pnpm doctor
```

## 路线图

- harness 客户端 shell 内的 Analytics 入口（左栏集成；客户端目前没有空闲插件页槽，因此仪表盘暂位于 `/analytics`）
- Skill / 子 agent ROI 与 reasoning-effort 效率
- 基于预算信号的成本异常告警

## 许可证

MIT
