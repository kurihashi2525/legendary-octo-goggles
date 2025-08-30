// functions/get-news.js

import Parser from 'rss-parser';

// 取得したいニュースフィードのリスト
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

export const handler = async (event, context) => {
    console.log("Netlify Functionが【複数カテゴリニュース】の取得リクエストを受け取りました。");
    
    const parser = new Parser();
    let allArticles = [];

    // Promise.allを使って、全てのフィードを並行して高速に取得
    try {
        const feedPromises = FEEDS.map(feedInfo => 
            parser.parseURL(feedInfo.url).then(feed => ({
                category: feedInfo.category,
                items: feed.items
            }))
        );

        const results = await Promise.all(feedPromises);

        // 取得した全記事を一つの配列にまとめる
        results.forEach(result => {
            if (result.items) {
                result.items.slice(0, 4).forEach(item => { // 各カテゴリから最大4件
                    allArticles.push({
                        headline: item.title,
                        type: 'real',
                        category: result.category,
                        timestamp: new Date(item.pubDate).getTime() || Date.now()
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