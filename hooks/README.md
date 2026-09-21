# hooks/

這個資料夾是 Claude Code 的 function-hook plugin 部分，`hooks.json` 指到 `jev.js`，引擎載入 plugin 時會執行它的 `register(on, options)`

## 它做的兩件事

1. `tool.call`，matcher `{ tool: "WebSearch" }`：模型每次呼叫內建 WebSearch，hook 先把 `query`、`allowed_domains`、`blocked_domains` 換成一個 Jev Search 請求，透過 `$.http.fetch` 打 `POST /api/ask`，把 NDJSON 收成一份結果，再組成 WebSearch 輸出 schema 要的形狀回給引擎。模型讀到的格式跟內建的一樣，開頭多一行 Answered by Jev Search，接著是帶相關度百分比的排序清單。搜尋中輸入框下方會釘一行 Jev Search…，成功後通知列跳一行 Jev Search: N results via 哪些來源 in 幾秒，幾秒後自己消掉
2. `tool.describe`，同樣的 matcher：在 WebSearch 的描述尾端補一段話，提醒模型把查詢寫成一句話、需要時用文字點名站台或時間範圍

## 什麼時候退回內建

以下任一情況 hook 會呼叫 `next(e)`，讓內建 WebSearch 照常執行，並在對話裡留一行暗色提示：

- Jev Search 回非 2xx，最常見是 hosted demo 每個 IP 每分鐘約 10 次的 429
- 網路錯誤、逾時、回應格式不對
- 套用 `allowed_domains` 或 `blocked_domains` 過濾後一筆都不剩
- hook 本身出錯或超過引擎給的時間預算，這是引擎的預設行為

`intercept` 設定關掉時，兩個 hook 都直接放行，什麼都不做

## 網域對應

`allowed_domains` 裡每個網域都對得上 Jev 來源時，直接用 `sources` 限制搜尋：

| 網域 | Jev 來源 |
| --- | --- |
| reddit.com | reddit |
| news.ycombinator.com | hackernews |
| github.com | github |
| arxiv.org | arxiv |
| youtube.com、youtu.be | youtube |
| wikipedia.org | wikipedia |
| imdb.com | imdb |
| x.com、twitter.com | x |
| mp.weixin.qq.com | wechat |

有任何一個對不上時，改成把網域用文字寫進請求，讓 Jev 自己判斷，結果再用網域過濾一次。`blocked_domains` 一律只在結果端過濾

## 設定

`plugin.json` 的 `userConfig` 宣告三個欄位，安裝時會問，之後在 `/config` 改，改完 plugin 會重新載入：

| 欄位 | 預設 | 說明 |
| --- | --- | --- |
| `baseUrl` | `https://jev.s1.dev` | Jev Search 實例，自架時改這裡，同一個值也會餵給 `.mcp.json` 裡的 MCP server |
| `intercept` | `true` | 關掉就不攔 WebSearch，只留 `jev_search` 工具給模型自己選 |
| `maxResults` | `10` | 每次攔截回幾筆 |

## 型別與檢查

`types/claude-code.d.ts` 是 Claude Code 2.1.278 用 `/plugin-types` 產出的宣告快照，`jev.js` 用 JSDoc 的 `@type {import('claude-code').Register}` 對著它型別檢查。這個 API 還在 early access，升版後在互動 session 跑 `/plugin-types` 重新產生，再把 `.claude/types/claude-code.d.ts` 複製過來取代快照，不要手改

```bash
npm run typecheck:hooks   # tsc -p tsconfig.hooks.json
npm run validate          # claude plugin validate，會列出 hook 掛了哪些事件、呼叫了 $ 的哪些方法
```

`claude plugin validate` 目前的輸出應該長這樣：

```
./jev.js hooks: tool.describe{tool=WebSearch}, tool.call{tool=WebSearch}
./jev.js calls: $.http.fetch (via answerWithJev), $.ui.log, $.ui.status
```

## 從 checkout 直接跑

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .
```

互動 session 會監看這個資料夾，存檔就重新載入 hook 模組。要看引擎拒絕了什麼，加 `--debug` 讀 debug log。hook 執行環境沒有 Node 也沒有 DOM，只能透過 `$` 對外，所以 `jev.js` 只 import `src/` 裡不碰 Node API 的純函式檔
