// functions/get-news.js

import Parser from 'rss-parser';

// Netlify Functions のお決まりの書き方
export const handler = async (event, context) => {
    console.log("Netlify Functionが【リアルタイムニュース】の取得リクエストを受け取りました。");
    
    // ニュース取得元 (Yahoo!ニュース 主要トピックス)
    const FEED_URL = 'https://news.yahoo.co.jp/rss/topics/top-picks.xml';
    
    // RSSパーサーの準備
    const parser = new Parser();

    try {
        // FEED_URLにアクセスして、最新ニュースを取得・解析
        const feed = await parser.parseURL(FEED_URL);
        
        // 取得したニュースから、必要な情報（タイトル）だけを抜き出す
        const newsItems = feed.items.slice(0, 8).map(item => ({
            title: item.title,
        }));

        // ブラウザに成功した結果（最新ニュースのリスト）を返す
        return {
            statusCode: 200,
            body: JSON.stringify([{ items: newsItems }]) // フロントエンドが期待する形式に合わせる
        };

    } catch (error) {
        console.error("リアルタイムニュースの取得に失敗しました:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "ニュースの取得に失敗しました。" })
        };
    }
};