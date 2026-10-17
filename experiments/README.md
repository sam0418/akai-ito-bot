# Experiments

正式功能之外的研究性實驗。每個實驗一個資料夾，彼此獨立，也和線上的 bot 隔離：

- `clasp` 只推送 `src/`，這裡的程式碼不會被部署。
- 實驗在本機用 Node 執行，只呼叫外部 API，不寫入正式的對話紀錄。

## 慣例

每個實驗資料夾的 `README.md` 依序記錄：

1. **背景**：為什麼要做
2. **假說**：要驗證什麼，以及什麼結果代表假說不成立
3. **方法**：實驗條件、測試資料、評估指標
4. **結果**：每次執行的數字與觀察
5. **結論**：採納、修改或放棄

## 在 GitHub Actions 上執行

`.github/workflows/experiment.yml` 可以在 GitHub 的伺服器上跑實驗（手動觸發）。
需要先在 repo 的 **Settings → Secrets and variables → Actions** 新增 secret `GEMINI_API_KEY`。

兩種觸發方式：

- **手動**：Actions 頁面 → experiment → Run workflow，填入參數。
- **推送分支**：在 `exp-run/` 開頭的分支放一份 `experiments/run-request.json`，推上去就會自動執行：

  ```json
  { "experiment": "001-vca-lite", "condition": "A", "model": "gemini-3.6-flash", "repeat": 3, "pace": 7000 }
  ```

結果會存成 workflow 的 artifact（`runs-<實驗>-<run id>`），保留 90 天。

只會用到 repo 內的虛構 fixtures；真實對話資料不在 repo 裡，Actions 也讀不到。

## 資料規則

- `fixtures/`：虛構的測試資料，可以提交。
- `data/`：真實對話資料，**永遠不提交**（已列入 `.gitignore`）。
- `runs/`：執行結果。用 `fixtures/` 跑的可以提交；用 `data/` 跑的不提交。

## 實驗列表

| # | 名稱 | 狀態 | 問題 |
|---|---|---|---|
| 001 | [vca-lite](001-vca-lite/) | 規劃中 | 以 VCA 的記憶設計補充上下文，能否改善需要長期記憶的翻譯？ |
