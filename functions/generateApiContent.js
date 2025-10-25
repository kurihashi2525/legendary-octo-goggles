// functions/generateApiContent.js (node-fetch v2 stream handling fix)
const { TransformStream } = require('node:stream/web'); // ← これは削除しないでください
const fetch = require('node-fetch');
const { Readable } = require('stream'); // Node.jsの組み込みストリームモジュール

exports.handler = async function(event, context) {
  console.log("generateApiContent function invoked.");
  let apiKey;

  try {
    const requestBody = JSON.parse(event.body || '{}');
    apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      console.error("GOOGLE_API_KEY is missing or undefined!");
      throw new Error("API Key is not configured.");
    }
    console.log("API Key loaded (first 5 chars):", apiKey.substring(0, 5));
    console.log("Request body received:", JSON.stringify(requestBody).substring(0, 100) + "...");

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

    console.log("Calling Google API:", apiUrl);
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log("Google API response status:", geminiResponse.status);

    if (!geminiResponse.ok || !geminiResponse.body) {
      const errorBody = await geminiResponse.text();
      console.error("Google API Error:", geminiResponse.status, errorBody);
      throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
    }

    console.log("Google API response OK. Starting stream handling.");

    // ★★★ ストリーム処理の修正 ★★★
    // node-fetch v2のストリームからデータを読み取り、Netlifyのレスポンスに書き込む
    const nodeReadableStream = geminiResponse.body;
    const webTransformStream = new TransformStream({
         transform(chunk, controller) {
            // Bufferをテキストに変換
            const text = Buffer.from(chunk).toString('utf-8');
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    // "data: " を除いたJSON部分をエンコードしてキューに追加
                    controller.enqueue(new TextEncoder().encode(line.substring(6)));
                }
            }
        }
    });

    // Node.jsのReadableストリームをWebのReadableStreamに変換
    const webReadableStream = Readable.toWeb(nodeReadableStream).pipeThrough(webTransformStream);
    // ★★★ 修正ここまで ★★★

    console.log("Stream handling set up. Returning response to client.");
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked'
      },
      body: webReadableStream, // 変換後のWeb ReadableStreamを返す
      isBase64Encoded: false
    };

  } catch (error) {
    console.error("Error caught in Netlify function:", error);
    console.error("API Key check in catch (first 5 chars):", apiKey ? apiKey.substring(0, 5) : "Not loaded");

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};