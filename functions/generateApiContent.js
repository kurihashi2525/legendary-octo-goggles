// functions/generateApiContent.js
import { TransformStream } from 'node:stream/web';
const fetch = require('node-fetch');

const createTransformStream = () => { /* ... (変更なし) ... */ };

exports.handler = async function(event, context) {
  // ★★★ デバッグログ追加 ★★★
  console.log("generateApiContent function invoked.");
  let apiKey; // スコープを広げる

  try {
    const requestBody = JSON.parse(event.body || '{}');
    apiKey = process.env.GOOGLE_API_KEY; // ★ここで代入

    // ★★★ デバッグログ追加 ★★★
    if (!apiKey) {
        console.error("GOOGLE_API_KEY is missing or undefined!");
        throw new Error("API Key is not configured.");
    }
    console.log("API Key loaded (first 5 chars):", apiKey.substring(0, 5)); // キーの一部だけ表示
    console.log("Request body received:", JSON.stringify(requestBody).substring(0, 100) + "..."); // リクエストボディの一部を表示

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

    // ★★★ デバッグログ追加 ★★★
    console.log("Calling Google API:", apiUrl);
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    // ★★★ デバッグログ追加 ★★★
    console.log("Google API response status:", geminiResponse.status);

    if (!geminiResponse.ok || !geminiResponse.body) {
      const errorBody = await geminiResponse.text();
      // ★★★ デバッグログ追加 ★★★
      console.error("Google API Error:", geminiResponse.status, errorBody);
      throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
    }

    // ★★★ デバッグログ追加 ★★★
    console.log("Google API response OK. Starting stream transformation.");
    const transformStream = createTransformStream();
    const readableStream = geminiResponse.body.pipeThrough(transformStream);

    // ★★★ デバッグログ追加 ★★★
    console.log("Stream transformation complete. Returning response to client.");
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked'
      },
      body: readableStream,
      isBase64Encoded: false
    };

  } catch (error) {
    // ★★★ デバッグログ追加 ★★★
    console.error("Error caught in Netlify function:", error);
    // エラー発生時もAPIキーが読み込めているか確認
    console.error("API Key check in catch (first 5 chars):", apiKey ? apiKey.substring(0, 5) : "Not loaded");

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};