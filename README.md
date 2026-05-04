# LeetCode Scoreboard

即時 LeetCode 比賽計分板。透過 [alfa-leetcode-api](https://github.com/alfaarghya/alfa-leetcode-api) 抓取選手提交紀錄，自動計算名次並每 30 秒更新一次。

## 前置需求

啟動 alfa-leetcode-api Docker 容器：

```bash
docker run -p 3000:3000 alfaarghya/alfa-leetcode-api
```

## 安裝與執行

```bash
npm install
npm run dev
```

開啟 http://localhost:5173

## 使用方式

點擊右上角 **⚙ Admin** 進入管理面板：

1. 設定比賽**開始與結束時間**
2. 輸入**題目清單**（Title Slug，每行一題，例如 `two-sum`）
3. 新增**選手 LeetCode Username**

儲存後自動開始抓取資料。所有設定存在瀏覽器 localStorage，重新整理不會遺失。

## 排名規則

1. 解題數多者優先
2. 解題數相同時，最後一題 AC 時間較早者排名較前

## 注意事項

- alfa-leetcode-api 每次最多回傳 20 筆最近 AC 紀錄
- 比賽期間盡量讓選手專注作答比賽題，避免大量 AC 其他題目將比賽紀錄擠出查詢範圍
- API 資料可能有數分鐘延遲（LeetCode 後端同步問題）
