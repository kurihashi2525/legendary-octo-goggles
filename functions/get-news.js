// functions/get-news.js

import fetch from 'node-fetch';
import cheerio from 'cheerio';

// ターゲットにするアンテナサイト
const ANTENNA_URL = 'https://livejupiter2.blog.jp/archives/cat_202389.html';

export const handler = async (event, context) => {
    console.log("Netlify Functionが【アンテナサイト】へのスクレイピングを開始します。");

    try {
        // 1. アンテナサイトのHTMLを取得
        const response = await fetch(ANTENNA_URL);
        if (!response.ok) {
            throw new Error(`サイトの取得に失敗: ${response.statusText}`);
        }
        const html = await response.text();

        // 2. cheerioを使ってHTMLを解析し、記事のタイトルを抽出
        const $ = cheerio.load(html);
        const articles = [];
        
        $('ul.article-list > li > a').each((i, el) => {
            const title = $(el).attr('title');
            if (title && articles.length < 20) { // 最大20件まで取得
                articles.push({
                    headline: title,
                    type: 'real', // これらは全て「現実の」ニュースとして扱う
                    category: $(el).find('span.blog_name').text() || 'なんJ', // サイト名を取得
                    timestamp: Date.now() - (i * 60000 * 5) // 5分間隔で時間を設定
                });
            }
        });

        // 3. 取得した記事をブラウザに返す
        return {
            statusCode: 200,
            body: JSON.stringify(articles)
        };

    } catch (error) {
        console.error("スクレイピングに失敗しました:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "外部サイトからの情報取得に失敗しました。" })
        };
    }
};