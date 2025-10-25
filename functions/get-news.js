// functions/get-news.js (CommonJS version)

const Parser = require('rss-parser'); // import -> require

const FEEDS = [
    { category: "主要", url: "https://news.yahoo.co.jp/rss/topics/top-picks.xml" },
    { category: "国内", url: "https://news.yahoo.co.jp/rss/topics/domestic.xml" },
    { category: "国際", url: "https://news.yahoo.co.jp/rss/topics/world.xml" },
    { category: "経済", url: "https://news.yahoo.co.jp/rss/topics/business.xml" },
    { category: "エンタメ", url: "https://news.yahoo.co.jp/rss/topics/entertainment.xml" },
    { category: "スポーツ", url: "https://news.yahoo.co.jp/rss/topics/sports.xml" },
    { category: "IT", url: "https://news.yahoo.co.jp/rss/topics/it.xml" },
    { category: "科学", url: "https://news.yahoo.co.jp/rss/topics/science.xml" },
];

// export const handler -> exports.handler
exports.handler = async (event, context) => {
    console.log("Netlify Functionが【複数カテゴリニュース】の取得リクエストを受け取りました。(CommonJS)");

    const parser = new Parser();
    let allArticles = [];

    try {
        const feedPromises = FEEDS.map(feedInfo =>
            parser.parseURL(feedInfo.url).then(feed => ({
                category: feedInfo.category,
                items: feed.items
            }))
        );

        const results = await Promise.all(feedPromises);

        results.forEach(result => {
            if (result.items) {
                result.items.slice(0, 4).forEach(item => {
                    allArticles.push({
                        headline: item.title,
                        type: 'real',
                        category: result.category,
                        timestamp: new Date(item.pubDate).getTime() || Date.now(),
                        // まとめサイトでリンクを開けるようにURLを追加
                        url: item.link
                    });
                });
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify(allArticles)
        };

    } catch (error) {
        console.error("リアルタイムニュースの取得に失敗しました:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "ニュースの取得に失敗しました。" })
        };
    }
};