// server.js

// 必要な部品をインポートします
import express from 'express';
import fetch from 'node-fetch'; // サーバーから外部サイトにアクセスするための部品

// サーバーの本体を作成します
const app = express();
const PORT = 3000; // サーバーがリクエストを待つ「ドア」の番号

// JSON形式のデータを正しく扱うためのおまじない
app.use(express.json());
// HTMLファイルがある場所をサーバーに教えるおまじない
app.use(express.static('.'));

// --- ここが「ニュース取得API」の本体です ---
app.post('/get-news', async (req, res) => {
    console.log("サーバーがニュース取得リクエストを受け取りました。");
    
    // ここで、本当は外部のニュースAPIを呼び出しますが、今回は超リアルなダミーニュースを返します。
    // (APIキーが必要なため、今回はこの形で本格的な動作をシミュレートします)
    const allNews = {
        "政治": [ { title: "〇〇内閣、支持率が過去最低の21%に急落。解散総選挙も視野か" }, { title: "来年度予算案、防衛費が過去最大規模に。野党は反発" } ],
        "芸能": [ { title: "人気俳優Aと女優Bが電撃結婚！公式サイトで発表" }, { title: "国民的アイドルグループ、年内での解散を電撃発表" } ],
        "学歴": [ { title: "「Fラン大学でも、人生逆転できるのか？」なんJ民の議論、白熱" }, { title: "東大生「正直、世間が見えてなかった…」バイト先での経験語る" } ],
        "プロ野球": [ { title: "巨人・岡本、3試合連続ホームラン！セ界の主砲、覚醒か" }, { title: "阪神、悪夢の逆転負けで自力優勝が消滅" } ],
        "MLB": [ { title: "【速報】大谷翔平、またしても破壊。特大の第50号ソロホームラン！" }, { title: "ダルビッシュ有、圧巻の12奪三振で今季10勝目をマーク" } ]
    };

    // 検索クエリに応じて、適切なカテゴリのニュースを返す
    const searchQueries = req.body.queries || [];
    const results = searchQueries.map(query => {
        let categoryKey = "話題のニュース";
        if (query.includes("政治")) categoryKey = "政治";
        else if (query.includes("芸能")) categoryKey = "芸能";
        else if (query.includes("学歴")) categoryKey = "学歴";
        else if (query.includes("プロ野球")) categoryKey = "プロ野球";
        else if (query.includes("大谷翔平")) categoryKey = "MLB";
        
        return { items: allNews[categoryKey] ? shuffleArray(allNews[categoryKey]) : [] };
    });

    res.json(results); // ブラウザに結果を返す
});

// サーバーを起動し、3000番のドアで待機させます
app.listen(PORT, () => {
    console.log(`サーバーが起動しました。 http://localhost:${PORT} で待機中です。`);
});

// 配列をシャッフルするヘルパー関数
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}