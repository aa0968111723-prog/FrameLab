# Hermes Console MCP

FrameLab 以 Streamable HTTP MCP 接 [Hermes Console](https://github.com/aa0968111723-prog/hermes-console)。Hermes 探測成功後，工具會以 `mcp.framelab.<name>` 出現在 Runtime；工作區 MCP 也會代理 `framelab_*` 工具。兩邊走同一條 `executeTool`，沒有第二套動畫邏輯。

GitHub 倉庫網址不是 MCP。端點必須是 `https://<FrameLab>/api/mcp`（本機探測才可用迴路 HTTP）。

## 連線

1. 在 FrameLab 工作室首頁按「產生連線權杖」。權杖只顯示一次。
2. 到 Hermes「設定 → 連線」填：
   - `FRAMELAB_MCP_URL`：`https://<FrameLab 網域>/api/mcp`
   - `FRAMELAB_MCP_TOKEN`：`fl_…` 權杖
3. 按「測試 FrameLab 連線」。成功條件是 `initialize` + `tools/list`，不是假裝已經修完動畫。

也可寫環境變數（或 `CONSOLE_MCP_SERVERS_JSON`）：

```bash
FRAMELAB_MCP_URL=https://framelab.example/api/mcp
FRAMELAB_MCP_TOKEN=fl_…
```

```json
[{
  "id": "framelab",
  "name": "FrameLab",
  "endpoint": "https://framelab.example/api/mcp",
  "credentialReference": "FRAMELAB_MCP_TOKEN",
  "readonly": false
}]
```

若同時設定 `FRAMELAB_MCP_URL`，不必重複放進 JSON。

伺服器對伺服器可用 `FRAMELAB_MCP_BOOTSTRAP_TOKEN`（對應同一個 Bearer 值）與選用的 `FRAMELAB_MCP_USER_ID`（預設 `hermes-console`）。Bootstrap 權杖有 READ/ANALYZE/SUGGEST/EDIT/GENERATE/RENDER，沒有 ADMIN。

## 協定

- 傳輸：Streamable HTTP，`POST /api/mcp`
- 版本：`2025-06-18`（也接受 `2025-03-26`、`2024-11-05`）
- 通知（無 `id`）回 `202` 並帶 `mcp-session-id`
- `GET` + `Accept: text/event-stream` 回 `405`（不推送 server 訊息，讓官方 SDK 跳過可選 SSE）
- `DELETE` 結束 session
- `tools/list` 帶 `readOnlyHint` / `destructiveHint`，給 Hermes 權限對應
- `tools/call` 回 `content` + `structuredContent`；payload 攤平在頂層（`projects`、`id`、`timelineId`），**不是** `{ ok, data }`
- 寫入／高風險工具需要 `confirmed=true`，與 UI 同一條 `executeTool`

## Hermes 工作區工具

探測後 Hermes 可直接呼叫：

- `framelab_list_projects` / `framelab_get_project` / `framelab_create_project` / `framelab_create_sample_project`
- `framelab_get_timeline` / `framelab_get_frame_window` / `framelab_get_keyframes`
- `framelab_analyze_consistency` / `framelab_get_problem_frames` / `framelab_suggest_repair`
- `framelab_create_inbetween_plan` / `framelab_generate_inbetweens` / `framelab_accept_generated_frames`
- `framelab_get_job` / `framelab_get_model_status` / `framelab_undo`
- `framelab_list_tools` / `framelab_call`（任意 FrameLab 工具）

Runtime 名稱是 `mcp.framelab.<name>`，與 FrameLab catalog 一對一。

## Hermes 應走的路徑

1. `framelab_list_projects` 或 `mcp.framelab.list_projects`
2. `get_timeline` → `get_frame_window`
3. 問題：`analyze_consistency` → `get_problem_frames` → `suggest_repair`
4. 中間張：`create_inbetween_plan` → `generate_inbetweens`（`confirmed=true`）→ `get_job` 輪詢 → `accept_generated_frames`
5. 不要把 GitHub 當 MCP；不要在沒有 job 結果時假裝已經修完。
