// functions/generateApiContent.js (Using export default for streaming Response)
// ★ node-fetch v2 を require する ★
const fetch = require('node-fetch');
// ★ TransformStream と Readable を require する ★
const { TransformStream } = require('node:stream/web');
const { Readable } = require('stream');

// Helper to transform Google's stream format (変更なし)
const createTransformStream = () => {
  return new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk); // Bufferを直接デコード
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          controller.enqueue(new TextEncoder().encode(line.substring(6)));
        }
      }
    }
  });
};

// ★ export default 形式に戻す ★
export default async (request, context) => {
  console.log("generateApiContent (export default) invoked.");
  let apiKey;
  try {
    // ★ リクエストボディの取得方法を変更 ★
    const requestBody = await request.json();
    apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      console.error("GOOGLE_API_KEY is missing!");
      throw new Error("API Key is not configured.");
    }
    console.log("API Key loaded (first 5):", apiKey.substring(0, 5));
    console.log("Request body:", JSON.stringify(requestBody).substring(0, 100) + "...");

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

    console.log("Calling Google API:", apiUrl);
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    console.log("Google API status:", geminiResponse.status);

    if (!geminiResponse.ok || !geminiResponse.body) {
      const errorBody = await geminiResponse.text();
      console.error("Google API Error:", geminiResponse.status, errorBody);
      throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
    }
    console.log("Google API OK. Setting up stream.");

    // ★ ストリーム処理 (node-fetch v2 + TransformStream) ★
    const nodeReadableStream = geminiResponse.body;
    const webTransformStream = createTransformStream(); // ヘルパー関数を呼び出す
    const webReadableStream = Readable.toWeb(nodeReadableStream).pipeThrough(webTransformStream);
    // ★ 修正ここまで ★

    console.log("Stream ready. Returning Response object.");
    // ★ Response オブジェクトを直接返す ★
    return new Response(webReadableStream, {
      status: 200, // ステータスコードを Response オブジェクトに含める
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in Netlify function:", error);
    console.error("API Key check (first 5):", apiKey ? apiKey.substring(0, 5) : "Not loaded");
    // ★ エラー時も Response オブジェクトを返す ★
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// ★ export const config は不要なので削除 ★