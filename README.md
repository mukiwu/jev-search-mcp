# jev-search-mcp

Jev Search for Claude Code and Codex: a function-hook plugin that answers the built-in WebSearch with Jev, plus the same search as an MCP server, a CLI and a skill. Zero runtime dependencies

把 [Jev Search](https://github.com/superagents-lab/jev-search) 接進 Claude Code 和 Codex。裝成 Claude Code plugin 時，內建的 WebSearch 會直接由 Jev 回答，Jev 答不出來才退回內建；裝成 npm 套件時，是一個 MCP server 加 CLI，Claude Code、Codex 或任何能跑 shell 的 agent 都能用

Jev Search 的流程是：Jev 模型先讀懂你的一句話，決定要查哪些來源、哪段時間、用什麼關鍵字，再透過 Search1API 同時打 Google、DuckDuckGo、Yandex，必要時加上 Hacker News、Reddit、GitHub、X、arXiv、YouTube、Wikipedia、IMDb、WeChat，最後每一筆結果都由 Jev 打相關度分數。回來的是排好序的連結和摘要，不是生成的答案

這個 repo 同時是 npm 套件（`src/`）和 Claude Code plugin（`hooks/`、`.claude-plugin/`、`.mcp.json`、`skills/`），plugin 直接用套件裡的純函式，兩邊行為一致

## 安裝方式一：Claude Code plugin

這是給 Claude Code 使用者的建議路徑，裝完不用改任何指令或習慣，WebSearch 照常呼叫，答案換成 Jev 的

Function hooks 是 Claude Code 的 early access 功能，需要 2.1.271 以上，並且在 Claude Code 讀得到的地方開旗標，例如 `~/.claude/settings.json`：

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

然後加入 [muki-ai-plugins](https://github.com/mukiwu/muki-ai-plugins) 這個 marketplace 並安裝，shell 或 session 裡的斜線指令都可以：

```sh
claude plugin marketplace add mukiwu/muki-ai-plugins
claude plugin install jev-search@muki-ai-plugins
```

安裝時會問三個設定：Jev Search 實例網址、要不要攔截 WebSearch、每次回幾筆，全部維持預設就是打官方的 jev.s1.dev。裝完重啟 Claude Code 或執行 `/reload-plugins`

之後你會得到：

- **WebSearch 由 Jev 回答**。模型讀到的格式跟內建一樣，多一行 Answered by Jev Search 和帶相關度百分比的排序清單。Jev 回錯誤、被限流、網路不通、或網域過濾後一筆都不剩，就自動退回內建 WebSearch，對話裡會留一行暗色提示
- **WebSearch 的描述多一段提醒**，讓模型把查詢寫成一句話，需要時用文字點名站台或時間範圍
- **一個 `jev_search` MCP 工具**，要明確指定 `sources` 或 `window` 時用
- **一個 `jev-search` skill**，教模型什麼時候該用、怎麼下請求

設定之後在 `/config` 裡改，改完 plugin 會重新載入。hook 的細節、退回條件、網域對應表在 [`hooks/README.md`](hooks/README.md)

不想安裝、只想從 checkout 試：

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .
```

marketplace 那邊只是一筆指向這個 repo 的紀錄，plugin 本體就是這裡的 `.claude-plugin/plugin.json`、`hooks/`、`.mcp.json` 和 `skills/`，安裝時會 clone 整個 repo

## 安裝方式二：npm

給 Codex、其他 MCP host、或不想開 function hooks 的人。套件零依賴，`npx` 直接跑，需要 Node 22

### 當 MCP server

```sh
# Claude Code
claude mcp add --scope user jev-search -- npx -y jev-search-mcp

# Codex
codex mcp add jev-search -- npx -y jev-search-mcp
```

Codex 也可以直接寫 `~/.codex/config.toml`，桌面版不一定帶著你的 shell PATH，`command` 建議寫絕對路徑：

```toml
[mcp_servers.jev-search]
command = "npx"
args = ["-y", "jev-search-mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.jev-search.env]
JEV_SEARCH_BASE_URL = "https://jev.s1.dev"
```

這條路不會攔截內建搜尋，要讓模型優先用 `jev_search`，在全域指令加一段，Claude Code 放 `~/.claude/CLAUDE.md`，Codex 放 `~/.codex/AGENTS.md`：

```
## 網頁搜尋先走 jev_search

- 要查網路資料時，先用 jev_search，不要先用內建的 web search
- 需求用一句話寫，Jev 會自己挑來源和時間範圍，要鎖來源填 sources，要鎖時間填 window
- jev_search 回錯誤或被限流時，才退回內建 web search
- 拿到連結後要讀全文，照平常的方式抓網頁，Jev 只做搜尋不抓頁面
```

想徹底關掉內建搜尋：Claude Code 在 `permissions.deny` 加 `WebSearch`，Codex 在 config.toml 頂層加 `web_search = "disabled"`。但這樣 Jev 被限流時就沒有備援

### 當 CLI

```sh
npx -y jev-search-mcp search "what do Reddit users think of the Framework laptop this month"
npx -y jev-search-mcp search "new papers on speculative decoding" --window 30d --sources arxiv --max 8
npx -y jev-search-mcp search "bun 1.3 release notes" --json
```

### 只裝 skill

```sh
npx skills add mukiwu/jev-search-mcp
```

[skills](https://www.npmjs.com/package/skills) CLI 會把 `skills/jev-search/SKILL.md` 裝進 Claude Code、Codex、Cursor 等工具的 skill 目錄。這條路不接 MCP，模型看到 skill 之後會改用上面的 CLI 從 shell 查

## 運作方式

1. 請求送到 `POST /api/ask`，帶同源的 `Origin` 標頭，超過 300 字在字邊界截斷
2. 上游以 NDJSON 串流回 `intent`、每個引擎的 `lane`、最後 `done`，這裡收齊後照上游的規則以 URL 去重合併，同一個 URL 被多個引擎命中會合併成一列
3. 排序跟網頁版一致：Jev 的相關度百分比優先，同分看幾個引擎命中，再看原始名次，還沒被打分的排最後
4. 攔截 WebSearch 時，`allowed_domains` 對得上 Jev 來源就直接限制來源，對不上就寫進請求文字並在結果端過濾，`blocked_domains` 只在結果端過濾

## 它不做什麼

- 不做本機檔案搜尋，Grep、Glob 那類工具跟它無關
- 不抓網頁全文，拿到連結後還是用 WebFetch 或原本的方式讀頁面
- 不儲存查詢紀錄，所有請求直接送到你設定的 Jev Search 實例

## 設定

Plugin 的三個欄位：

| 欄位 | 預設 | 說明 |
| --- | --- | --- |
| `baseUrl` | `https://jev.s1.dev` | Jev Search 實例，hook 和 MCP server 共用 |
| `intercept` | `true` | 關掉就不攔 WebSearch，只留 `jev_search` 工具 |
| `maxResults` | `10` | 攔截 WebSearch 時回幾筆 |

MCP server 與 CLI 的環境變數：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `JEV_SEARCH_BASE_URL` | `https://jev.s1.dev` | Jev Search 實例的網址，只取 origin |
| `JEV_SEARCH_TIMEOUT_MS` | `35000` | 單次搜尋的逾時，伺服器端本身是 30 秒 |
| `JEV_SEARCH_MAX_RESULTS` | `10` | 沒填 `max_results` 時的預設筆數 |

`jev_search` 工具與 CLI 的參數：

| 參數 | CLI | 說明 |
| --- | --- | --- |
| `query` | 位置參數 | 一句話描述要找什麼 |
| `window` | `--window` | `any`、`24h`、`7d`、`30d`，不填讓 Jev 判斷 |
| `sources` | `--sources a,b` | 來源清單，不填讓 Jev 判斷 |
| `max_results` | `--max` | 回傳幾筆，最多 40 |

## 自架 Jev Search

官方實例 jev.s1.dev 是別人的帳單，也有每個 IP 每分鐘約 10 次的限制，量大或想穩定就自己架。照上游 README 部署到 Cloudflare Workers，需要 Search1API 的 key 和至少一個 Jev provider 的憑證，架好後把 plugin 的 `baseUrl` 或環境變數 `JEV_SEARCH_BASE_URL` 指過去即可

本機開發時上游跑在 `http://localhost:3030`，同樣可以直接指過去

## 開發

```sh
npm install                # 只裝 dev 依賴，執行時零依賴
npm test                   # node:test，含真實 stdio 協定測試與 hook 測試，不需要網路
npm run typecheck:hooks    # 用 types/claude-code.d.ts 檢查 hook
npm run validate           # claude plugin validate
npm run smoke -- "Rust async runtimes on Hacker News this month"
```

- `src/client.js` 打 `POST /api/ask`，串流或整段文字都能收，純函式部分給 hook 共用
- `src/rank.js` 從上游移植 URL 去重和排序規則
- `src/format.js` 把結果排成給模型讀的文字
- `src/websearch-bridge.js` WebSearch 輸入與 Jev 請求、Jev 結果與 WebSearch 輸出之間的轉換
- `src/tool.js` 工具定義、參數驗證、設定讀取，server 和 CLI 共用
- `src/mcp.js` 手寫的 JSON-RPC over stdio，只實作 tools 相關方法
- `src/server.js` MCP 進入點，`src/cli.js` npx 進入點
- `hooks/jev.js` function hook，見 `hooks/README.md`
- `types/claude-code.d.ts` Claude Code 的型別快照，用 `/plugin-types` 重新產生
- `.claude-plugin/plugin.json` plugin manifest，marketplace 紀錄在 [muki-ai-plugins](https://github.com/mukiwu/muki-ai-plugins)

## 授權

MIT，Jev Search 本身也是 MIT，TypeSafe 與 Jev 的名稱和商標屬於各自的持有者
