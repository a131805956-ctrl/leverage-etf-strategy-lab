# Exposure Lab｜槓桿 ETF 策略實驗室

可重現、可擴充的 ETF 策略研究網站，第一版支援：

- 0050／00631L 與 00646／00647L 分組回測。
- 任一歷史共同交易日起始、單次投入與小數單位。
- 新高、回撤加碼、反彈減倉、事件／週期／偏離再平衡。
- 總報酬、純價格、股息暫存現金及指定日期再投入。
- 下一交易日開盤成交、交易成本與滑價。
- 策略、原型 ETF、槓桿 ETF 比較及操作標記。
- 多組策略組合與跨組月／季／年／偏離再平衡。
- Pareto 多目標窮舉與 ChatGPT 分析包。
- IndexedDB 方案庫與 JSON 匯入匯出。

## 公開網址

- Tailscale Funnel：`https://desktop-loi23mp.tail9c076e.ts.net/leverage-etf/`
- GitHub Pages：啟用後由 Repository 的 Deployments 顯示。

Tailscale 網址需要這台電腦、Tailscale 與本機 preview 服務持續運作。GitHub Pages 是靜態備援。

## 一鍵啟動

PowerShell：

```powershell
.\scripts\start.ps1
```

網站服務位於 `http://127.0.0.1:4175/leverage-etf/`。

另一個 PowerShell 視窗啟用公開路由：

```powershell
.\scripts\funnel.ps1 Start
```

檢查路由：

```powershell
.\scripts\funnel.ps1 Status
```

## 資料更新

網站每次啟動會判斷四個標的是否至少涵蓋上個月月底；不足時才更新。手動更新：

```powershell
.\scripts\update-data.ps1
```

資料源為 Yahoo Finance chart API。資料畫面會顯示必要截止日、各標的最新日期與筆數。

## 開發與驗證

```powershell
npm install
npm run dev
npm run verify
```

`npm run verify` 依序執行 ESLint、TypeScript、Vitest 與 production build。

## 架構

```text
src/core           純函數回測、規則、績效與多組組合
src/data           資料格式、載入與月度更新政策
src/storage        IndexedDB 與可攜式方案格式
src/optimization   網格搜尋與 Pareto 前緣
src/analysis       JSON、CSV 與 ChatGPT 分析提示
src/ui             工作台與金融圖表 adapter
scripts            資料、啟動、驗證與 Funnel 維護
tests              領域行為測試
```

完整規格位於 `docs/superpowers/specs/`。

## GitHub 維護方式

1. 從 `main` 建立 `feature/<name>`。
2. 使用 Conventional Commit，例如 `feat: add rolling return chart`。
3. 推送分支並建立 Pull Request。
4. CI 的 lint、typecheck、test、build 全部通過後才合併。
5. 發布版使用 `v0.x.y` tag 與 GitHub Release。

## 重要限制

- 本工具僅供研究與教育，不是投資建議。
- 槓桿 ETF 有路徑依賴、波動耗損、追蹤誤差與極端回撤。
- 回測結果不代表未來績效；參數最佳化必須搭配樣本外驗證。
- Yahoo Finance 並非交易所官方資料，正式決策前應與可信資料源交叉核對。

