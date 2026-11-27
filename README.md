# Songloft 插件：播放统计

> **本 fork 基于 [songloft-org/songloft-plugin-stats](https://github.com/songloft-org/songloft-plugin-stats)（原版作者 Songloft Team，[项目主页](https://lllh.de)），由 [david0501z](https://github.com/david0501z) 维护。原版版权归原作者所有，本 fork 依 Apache-2.0 保留其归属，仅在此之上增补改动，详见下方「本 fork 相对原版的改动」。

## 本 fork 相对原版的改动

- **排除歌单**：推荐（随便听听 / 免切歌精选等）时跳过指定歌单内的歌曲，适合把儿童歌曲、特定场景歌单排除在外。
- **切歌补位**：快速切歌（播放没几秒就切）后自动挑不同风格歌曲插入播放队列，不阻断切歌，AI 未响应自动回退规则挑选。
- **新歌同步**：每日定时从洛雪音源插件榜单拉取新歌（网易云/QQ音乐/酷狗/酷我/咪咕多平台、榜单多选），过滤已存在、说唱榜与儿歌关键词后加入指定歌单；未装洛雪插件时功能自动隐藏。
- **AI 推理开关**：AI 建歌单 / 听歌报告 / 标签补全可分别开关，支持配置推理模型的 disableThinking 以控制 token 预算。
- **播放历史**：支持单条删除（内联 onclick 自包含处理器，规避隔离世界监听失效）；历史列表 60s 轮询去闪烁、查看更多不再重置回第一页。
- **自定义关键词**：新歌同步的排除关键词改为可增删标签列表（chip + × 删除，竖屏友好）。
- **更新源**：`updateUrl` 指向本 fork（`david0501z/songloft-plugin-stats`），便于自托管更新。

一个用于 Songloft 的播放数据统计与推荐插件。自动记录播放完成事件，提供播放次数、听歌时长、歌曲/艺术家排行、趋势与时段分布等可视化统计；并支持智能歌单推荐（模式推荐 + 规则歌单）、AI 功能（AI 建歌单 / AI 听歌报告 / AI 标签补全）、定时推送日报（飞书 / WxPusher）和 WebDAV 备份与恢复。

## 特性

- **播放记录**：订阅播放完成事件（finish）自动记录，内置去重机制（同一首歌在动态窗口内不重复计数）；切歌（skip）单独计数供推荐使用。
- **统计概览**：今日 / 本周 / 本月 / 全部 四个时间范围，展示播放次数、听歌时长、不同歌曲、不同艺术家，以及来源与媒体类型分布。
- **排行榜**：热门艺术家、热门歌曲、热门专辑 Top 10。
- **趋势与分布**：按天播放趋势柱状图（7/14/30 天）、四个时段播放分布。
- **最近播放**：去重视图与原始历史列表，支持加载更多。
- **智能推荐**：随便听听 / 久未听的宝藏 / 当前时段偏好 / 免切歌精选 / 最爱流派 五种模式，一键物化为主程序中的真实歌单。
- **规则歌单**：按流派 / 艺术家 / 专辑 / 收藏 / 年份 / 播放次数 / 多久没听组合筛选（条件间 AND 关系），支持定时自动刷新。
- **tag 插件联动**：检测曲库流派/年份标签覆盖率，一键触发标签刮削插件（entryPath: `tag`）增量补全。
- **AI 功能**（需配置任意 OpenAI 兼容服务）：
  - **AI 建歌单**：一句话描述翻译成筛选规则，本地规则引擎执行预览（零幻觉），确认后保存为规则歌单；
  - **AI 听歌报告**：基于真实统计数据生成个性化文案，可手动推送，可定时（周报每周一 / 月报每月 1 日）；
  - **AI 标签补全**：LLM 推断缺失的流派/年份并写回曲库，作为标签刮削不到时的兜底。
- **排除歌单**：推荐（随便听听 / 免切歌精选等）时跳过指定歌单内的歌曲，适合把儿童歌曲、特定场景歌单排除在外。
- **切歌补位**：快速切歌（播放没几秒就切）后自动挑不同风格歌曲插入播放队列（客户端 `player.insertToQueue`），不阻断切歌，AI 未响应自动回退规则挑选。**测试环境：Flutter Android 客户端可用；Lynx 客户端不可用——插件运行时在 Lynx 上无法保持，切歌补位依赖的播放事件持续监听会随插件生命周期失效，故该功能在 Lynx 上不生效。**
- **新歌同步**：每日定时从洛雪音源插件榜单拉取新歌（支持网易云/QQ音乐/酷狗/酷我/咪咕，榜单多选），过滤已存在、说唱榜与儿歌关键词后加入指定歌单。**未安装洛雪音源插件时该功能自动隐藏。**
- **定时推送**：每日定时将昨日统计摘要推送到 飞书 / WxPusher（两平台共用一个推送时间）。
- **WebDAV 备份**：手动 / 定时备份播放历史到 WebDAV 服务器，支持浏览服务器文件并恢复导入。

## 使用说明

### 安装与开发

```bash
# 安装依赖
npm install

# 编译构建（生成 dist/stats.jsplugin.zip）
npm run build

# 验证插件
npm run validate

# 运行单元测试
npm test
```

将 `dist/stats.jsplugin.zip` 上传到 Songloft 即可使用。

> 构建时 `src/` 由 esbuild 打包为 `main.js`（可用时编译为 `main.jsc` 字节码），`static/js/` 打包为单文件 `app.bundle.js` 并自动改写 index.html 引用，静态资源文件名自动注入内容 hash，无需手动处理。

## 目录结构

```
songloft-plugin-stats/
├── plugin.json              # 插件元数据（名称、入口、权限、哈希）
├── package.json             # 构建 / 测试 / 验证脚本
├── tsconfig.json            # TypeScript 配置
├── src/
│   ├── main.ts              # 生命周期入口（onInit / onDeinit / onHTTPRequest）
│   ├── router.ts            # HTTP 路由注册（/api/*）
│   ├── store.ts             # 播放历史存储、写入队列与增量聚合
│   ├── aggregator.ts        # 统计计算（概览 / 趋势 / 时段分布）
│   ├── scheduler.ts         # 播放事件订阅、保活心跳与推送/备份/推荐/AI报告定时调度
│   ├── pusher.ts            # 飞书 / WxPusher 推送实现与内容构建
│   ├── webdav.ts            # WebDAV 连接 / 列举 / 上传 / 下载
│   ├── skipinsert.ts        # 切歌补位：服务端挑不同风格歌曲 + 配置
│   ├── syncnew.ts           # 新歌同步：洛雪榜单拉取 + 筛选 + 入库 + 每日定时
│   ├── push/config.ts       # 推送平台与定时配置
│   ├── backup/config.ts     # WebDAV 备份配置与定时
│   ├── recommend/
│   │   ├── playlists.ts     # 模式推荐生成与歌单物化
│   │   ├── rules.ts         # 规则歌单定义 / 求值 / 物化 / 曲库分面
│   │   ├── profile.ts       # 歌曲画像、曲库枚举与收藏集合
│   │   ├── scorer.ts        # 评分与加权抽样
│   │   └── linkage.ts       # 与标签刮削插件（tag）的 HTTP 联动
│   ├── ai/
│   │   ├── client.ts        # OpenAI 兼容客户端（配置存储 + chat completions）
│   │   ├── report.ts        # AI 听歌报告生成与定时配置
│   │   ├── nlplaylist.ts    # 自然语言 → 规则解析与预览
│   │   └── tagger.ts        # AI 标签补全（经宿主 REST 写回）
│   └── types.ts             # 类型定义
├── tests/                   # 单元测试（node --test）
└── static/
    ├── index.html           # 前端页面（统计 / 推荐 / 设置 三大 Tab）
    ├── js/                  # ES 模块前端（构建时打包为 app.bundle.js）
    └── css/style.css        # 组件样式（引用 --md-* 变量）
```

## API 一览

插件通过 `onHTTPRequest` 暴露以下接口（路径均经 `/api/v1/jsplugin/stats` 前缀路由，前端使用 `SongloftPlugin.apiGet/apiPost` 调用）：

### 统计与历史

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats/summary` | 统计概览；可带 `from`/`to`（毫秒时间戳）查询指定范围 |
| GET | `/api/stats/trends?days=7` | 按天播放趋势（1–90 天） |
| GET | `/api/stats/hourly` | 四时段（凌晨/上午/下午/晚上）播放分布 |
| GET | `/api/history` | 去重播放历史（每首歌取最近一条，分页） |
| GET | `/api/history/raw` | 原始播放历史（不去重，`limit`/`offset` 分页） |
| POST | `/api/history/delete` | 删除指定播放记录（body `{records:[{songId,timestamp}]}`，按 songId+timestamp 匹配） |
| GET | `/api/export` | 导出全部历史（JSON 附件下载） |
| POST | `/api/import` | 导入历史（按 songId+timestamp 去重合并），body 为 `{records:[...]}` 或裸数组 |
| POST | `/api/reset` | 清空播放历史与切歌计数 |
| GET/POST | `/api/settings` | 读取 / 保存设置（`maxHistory` 历史上限，1000–100000） |

### 定时推送

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/push/config` | 飞书 / WxPusher 配置与推送时间（POST body 可含 `config`、`schedule`） |
| POST | `/api/push/test` | 发送测试推送（`platform`: feishu/wxpusher） |

### WebDAV 备份

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/backup/webdav/config` | 备份服务器配置增删改查（POST `action`: add/update/delete） |
| POST | `/api/backup/webdav/test` | 测试 WebDAV 连接（body `config`） |
| GET | `/api/backup/webdav/list` | 列举服务器上的备份文件（`configName`/`path`） |
| POST | `/api/backup/upload` | 上传当前历史为备份（body `configName`） |
| POST | `/api/backup/download` | 下载指定备份内容（body `configName`/`fileName`，恢复由前端调 `/api/import`） |
| GET/POST | `/api/backup/schedule` | 定时备份配置（POST body `{action:'save', schedule}`） |

### 智能推荐与规则歌单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/recommend/modes` | 推荐模式列表与累计切歌数 |
| GET | `/api/recommend?mode=&limit=` | 生成推荐列表（不落库，`mode` 五选一） |
| POST | `/api/recommend/apply` | 生成并物化为真实歌单（body `mode`/`limit`） |
| GET | `/api/recommend/facets` | 曲库流派与年份分面（供前端下拉框） |
| GET/POST | `/api/recommend/rules` | 规则列表 / 新增更新（body `rule`）/ 删除（body `action:'delete', id`） |
| GET | `/api/recommend/rules/preview?id=` | 预览规则命中的歌曲 |
| POST | `/api/recommend/rules/apply` | 将规则物化为歌单（body `id`） |
| GET/POST | `/api/recommend/schedule` | 推荐定时刷新配置（时间 + 模式 + 是否含规则歌单） |
| POST | `/api/recommend/refresh` | 立即执行一轮推荐刷新 |

### 排除歌单 / 切歌补位 / 新歌同步

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/recommend/exclude` | 推荐时排除的歌单（body `{exclude:[歌单名]}`） |
| GET/POST | `/api/skipinsert/config` | 切歌补位配置（`enabled`/`count`/`quickSkipSec`/`debounceSec`/`useAi`） |
| POST | `/api/skipinsert/pick` | 快速切歌后挑不同风格歌曲（body `lastSong`/`count`/`queueIds`） |
| POST | `/api/skipinsert/diag` | 客户端桥接/插入结果诊断上报 |
| GET/POST | `/api/syncnew/config` | 新歌同步配置（`enabled`/`limit`/`boards`/`playlistId`/`hour`/`minute`/`excludeRap`/`excludeKids`/`excludeKeywords`） |
| GET | `/api/syncnew/playlists` | 歌单列表（供目标歌单下拉框） |
| GET | `/api/syncnew/boards` | 洛雪榜单列表（多平台分组 `{available, platforms:[{id,name,boards}]}`；`available:false`=未装洛雪插件，前端隐藏该功能；排除各平台说唱榜） |
| POST | `/api/syncnew/run` | 立即执行一次新歌同步（body `{dryRun}`） |

### tag 插件联动

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/linkage/tag/status` | tag 插件可用性 + 曲库流派/年份覆盖率 |
| POST | `/api/linkage/tag/scrape` | 触发 tag 插件增量刮削，返回 `{taskId, total}` |
| GET | `/api/linkage/tag/progress?taskId=` | 查询刮削进度，完成时自动失效曲库缓存 |

### AI 功能（需先配置 OpenAI 兼容服务）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/ai/config` | 读取 / 保存 AI 服务配置（`baseUrl`/`apiKey`/`model`/`disableThinking`） |
| POST | `/api/ai/test` | AI 连通性测试 |
| POST | `/api/ai/nlplaylist` | 自然语言解析为规则并返回前 20 条预览（body `text`） |
| POST | `/api/ai/report` | 生成 AI 听歌报告（`period`: week/month，`push`: 是否同时推送） |
| GET/POST | `/api/ai/report/schedule` | AI 报告定时推送（周报每周一 / 月报每月 1 日） |
| GET | `/api/ai/tag/status` | 缺流派/年份标签的本地歌曲统计 + 补全进度 |
| POST | `/api/ai/tag/start` | 启动一轮 AI 标签补全（后台分批执行，每轮最多 200 首） |
| GET | `/api/ai/tag/progress` | 查询补全进度 |

## 已知约束

- **AI 请求单次上限 30 秒**：宿主 fetch 代理有固定超时（`X-Fetch-Timeout-Ms` 只能下调不能上调），本地慢模型（如冷启动的 Ollama）可能超时。
- **保活心跳**：插件内置 5 分钟心跳，避免被宿主空闲驱逐后丢失播放事件订阅（驱逐期间发生的播放不会被记录）。代价是插件 VM 常驻内存。
- **定时任务误差**：插件被驱逐后，宿主会在下次定时任务前约 2 分钟自动唤醒插件，任务触发误差在 1–2 分钟内。
