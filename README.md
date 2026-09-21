# jev-search-mcp

[Jev Search](https://github.com/superagents-lab/jev-search) as an MCP server, a Claude Code plugin and a CLI, with zero runtime dependencies

把 Jev Search 包成 MCP server、Claude Code plugin 和 CLI，讓 Claude Code 和 Codex 查網路資料時改走 Jev，不用內建的 web search

Jev Search 的流程是：Jev 模型先讀懂你的一句話，決定要查哪些來源、哪段時間、用什麼關鍵字，再透過 Search1API 同時打 Google、DuckDuckGo、Yandex，必要時加上 Hacker News、Reddit、GitHub、X、arXiv、YouTube、Wikipedia、IMDb、WeChat，最後每一筆結果都由 Jev 打相關度分數。回來的是排好序的連結和摘要，不是生成的答案

## Quick install

```bash
# Claude Code plugin (MCP tool + skill), nothing to build
/plugin marketplace add mukiwu/jev-search-mcp
/plugin install jev-search@jev-search-mcp

# Skill only, for Claude Code, Codex, Cursor and friends; the skill calls the CLI through npx
npx skills add mukiwu/jev-search-mcp

# Plain MCP server
claude mcp add --scope user jev-search -- npx -y jev-search-mcp
codex mcp add jev-search -- npx -y jev-search-mcp

# One-shot search from the shell
npx -y jev-search-mcp search "what do Reddit users think of the Framework laptop this month"
```

## 三種裝法

### 1. Claude Code plugin

在 Claude Code 裡執行：

```
/plugin marketplace add mukiwu/jev-search-mcp
/plugin install jev-search@jev-search-mcp
```

裝完會多一個 MCP 工具 `jev_search` 和一個同名 skill，skill 負責教模型什麼時候該用、怎麼下一句話的請求。server 直接用你機器上的 Node 22 跑，沒有 npm install 那一步

### 2. 只裝 skill

```bash
npx skills add mukiwu/jev-search-mcp
```

[skills](https://www.npmjs.com/package/skills) CLI 會把 `skills/jev-search/SKILL.md` 裝進 Claude Code、Codex、Cursor 等工具的 skill 目錄。這條路不接 MCP，模型看到 skill 之後會改用 `npx -y jev-search-mcp search "..."` 從 shell 查，所以只要有 Node 22 就能用

### 3. 手動接 MCP server

```bash
# Claude Code
claude mcp add --scope user jev-search -- npx -y jev-search-mcp

# Codex
codex mcp add jev-search -- npx -y jev-search-mcp
```

或者 clone 下來直接指到 `src/server.js`，Codex 的桌面版不一定帶著你的 shell PATH，`command` 請寫 node 的絕對路徑：

```toml
[mcp_servers.jev-search]
command = "/path/to/node"
args = ["/path/to/jev-search-mcp/src/server.js"]
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.jev-search.env]
JEV_SEARCH_BASE_URL = "https://jev.s1.dev"
```

## 讓模型優先用它

工具描述本身已寫明要取代 WebSearch，plugin 附的 skill 也會教模型何時該用。想更明確，在全域指令加一段：

- Claude Code 放在 `~/.claude/CLAUDE.md`
- Codex 放在 `~/.codex/AGENTS.md`

```
## 網頁搜尋先走 jev_search

- 要查網路資料時，先用 jev_search，不要先用內建的 web search
- 需求用一句話寫，Jev 會自己挑來源和時間範圍，要鎖來源填 sources，要鎖時間填 window
- jev_search 回錯誤或被限流時，才退回內建 web search
- 拿到連結後要讀全文，照平常的方式抓網頁，Jev 只做搜尋不抓頁面
```

想徹底關掉內建搜尋：Claude Code 在 `permissions.deny` 加 `WebSearch`，Codex 在 config.toml 頂層加 `web_search = "disabled"`。但這樣 Jev 被限流時就沒有備援，建議先用上面的軟性做法

## 它不做什麼

- 不做本機檔案搜尋，Grep、Glob 那類工具跟它無關
- 不抓網頁全文，拿到連結後還是用 WebFetch 或原本的方式讀頁面
- 不儲存查詢紀錄，所有請求直接送到你設定的 Jev Search 實例

## 工具參數

| 參數 | 說明 |
| --- | --- |
| `query` | 一句話描述要找什麼，超過 300 字會在字邊界截斷 |
| `window` | 強制時間範圍，`any`、`24h`、`7d`、`30d`，不填讓 Jev 判斷 |
| `sources` | 強制來源清單，不填讓 Jev 判斷 |
| `max_results` | 回傳幾筆，預設 10，最多 40 |

CLI 的對應選項是 `--window`、`--sources a,b,c`、`--max n`，加 `--json` 會印原始合併結果

## 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `JEV_SEARCH_BASE_URL` | `https://jev.s1.dev` | Jev Search 實例的網址，只取 origin |
| `JEV_SEARCH_TIMEOUT_MS` | `35000` | 單次搜尋的逾時，伺服器端本身是 30 秒 |
| `JEV_SEARCH_MAX_RESULTS` | `10` | 沒填 `max_results` 時的預設筆數 |

## 自架 Jev Search

官方實例 jev.s1.dev 是別人的帳單，也有每個 IP 每分鐘約 10 次的限制，量大或想穩定就自己架。照上游 README 部署到 Cloudflare Workers，需要 Search1API 的 key 和至少一個 Jev provider 的憑證，架好後把 `JEV_SEARCH_BASE_URL` 指過去即可

本機開發時上游跑在 `http://localhost:3030`，同樣可以直接指過去

## 開發

```bash
git clone https://github.com/mukiwu/jev-search-mcp.git
cd jev-search-mcp
npm install              # 只裝測試用的 MCP SDK，執行時零依賴
npm test                 # node:test，含真實 stdio 協定測試，不需要網路
npm run smoke -- "Rust async runtimes on Hacker News this month"
npm run validate         # claude plugin validate
```

- `src/client.js` 打 `POST /api/ask`，把 NDJSON 串流收成一個結果
- `src/rank.js` 從上游移植 URL 去重和排序規則，跟網頁版排法一致
- `src/format.js` 把結果排成給模型讀的文字
- `src/tool.js` 工具定義、參數驗證、設定讀取，server 和 CLI 共用
- `src/mcp.js` 手寫的 JSON-RPC over stdio，只實作 tools 相關方法
- `src/server.js` MCP 進入點，`src/cli.js` npx 進入點
- `.claude-plugin/`、`.mcp.json`、`skills/` 是 Claude Code plugin 的部分，repo 本身就是 marketplace

## 授權

MIT，Jev Search 本身也是 MIT，TypeSafe 與 Jev 的名稱和商標屬於各自的持有者
