# jev-search-mcp

把 [Jev Search](https://github.com/superagents-lab/jev-search) 包成 MCP server，讓 Claude Code 和 Codex 查網路資料時可以改走 Jev，不用內建的 web search

Jev Search 的流程是：Jev 模型先讀懂你的一句話，決定要查哪些來源、哪段時間、用什麼關鍵字，再透過 Search1API 同時打 Google、DuckDuckGo、Yandex，必要時加上 Hacker News、Reddit、GitHub、X、arXiv、YouTube、Wikipedia、IMDb、WeChat，最後每一筆結果都由 Jev 打相關度分數。回來的是排好序的連結和摘要，不是生成的答案

## 它不做什麼

- 不做本機檔案搜尋，Grep、Glob 那類工具跟它無關
- 不抓網頁全文，拿到連結後還是用 WebFetch 或原本的方式讀頁面
- 不儲存查詢紀錄，所有請求直接送到你設定的 Jev Search 實例

## 需求

- Node.js 22 以上
- 一個可用的 Jev Search 實例，預設用官方的 https://jev.s1.dev，每個 IP 每分鐘約 10 次；要自架的話見下方

## 安裝

```bash
git clone <this repo> ~/Documents/01.project/jev-search-mcp
cd ~/Documents/01.project/jev-search-mcp
npm install
npm test
npm run smoke            # 真的打一次 API，確認整條路通
```

## 接到 Claude Code

```bash
claude mcp add --scope user --transport stdio jev-search \
  --env JEV_SEARCH_BASE_URL=https://jev.s1.dev \
  -- "$(which node)" ~/Documents/01.project/jev-search-mcp/src/server.js
```

工具名會是 `mcp__jev-search__jev_search`，可以加進 `~/.claude/settings.json` 的 `permissions.allow` 省掉確認

要讓 Claude 優先用它，在全域 CLAUDE.md 加一段規則即可，工具描述本身也已經寫明要取代 WebSearch。想徹底關掉內建搜尋，在 `permissions.deny` 加 `WebSearch`，但這樣 Jev 被限流時就沒有備援

## 接到 Codex

在 `~/.codex/config.toml` 加上：

```toml
[mcp_servers.jev-search]
command = "/path/to/node"
args = ["/Users/<you>/Documents/01.project/jev-search-mcp/src/server.js"]
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.jev-search.env]
JEV_SEARCH_BASE_URL = "https://jev.s1.dev"
```

Codex 的桌面版不一定帶著你的 shell PATH，`command` 請寫 node 的絕對路徑

要讓 Codex 優先用它，在 `~/.codex/AGENTS.md` 加一段規則。想徹底關掉內建搜尋，在 config.toml 頂層加 `web_search = "disabled"`

## 工具參數

| 參數 | 說明 |
| --- | --- |
| `query` | 一句話描述要找什麼，超過 300 字會在字邊界截斷 |
| `window` | 強制時間範圍，`any`、`24h`、`7d`、`30d`，不填讓 Jev 判斷 |
| `sources` | 強制來源清單，不填讓 Jev 判斷 |
| `max_results` | 回傳幾筆，預設 10，最多 40 |

## 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `JEV_SEARCH_BASE_URL` | `https://jev.s1.dev` | Jev Search 實例的網址，只取 origin |
| `JEV_SEARCH_TIMEOUT_MS` | `35000` | 單次搜尋的逾時，伺服器端本身是 30 秒 |
| `JEV_SEARCH_MAX_RESULTS` | `10` | 沒填 `max_results` 時的預設筆數 |

## 自架 Jev Search

官方實例是別人的帳單，也有每分鐘 10 次的限制，量大或想穩定就自己架。照上游 README 部署到 Cloudflare Workers，需要 Search1API 的 key 和至少一個 Jev provider 的憑證，架好後把 `JEV_SEARCH_BASE_URL` 指過去即可

本機開發時上游跑在 `http://localhost:3030`，同樣可以直接指過去

## 開發

```bash
npm test                 # node:test，不需要網路
npm run smoke -- "Rust async runtimes on Hacker News this month"
```

- `src/client.js` 打 `POST /api/ask`，把 NDJSON 串流收成一個結果
- `src/rank.js` 從上游移植 URL 去重和排序規則，跟網頁版排法一致
- `src/format.js` 把結果排成給模型讀的文字
- `src/server.js` MCP 進入點

## 授權

MIT，Jev Search 本身也是 MIT，TypeSafe 與 Jev 的名稱和商標屬於各自的持有者
