// netlify/functions/generateApiContent.js

const ALLOWED_ORIGIN = "https://peppy-bombolone-94f3a7.netlify.app";
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

const MAX_PROMPT_LENGTH = 30000; // 入力文字数制限 (コスト爆発防止)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.handler = async function(event, context) {
  // --- 1. タイムアウト制御の準備 ---
  // Netlifyに強制終了される前に、自分で処理を打ち切るためのタイマー
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETLIFY_TIMEOUT_MS);

  try {
    // --- 2. 基本的なセキュリティチェック ---
    const headers = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
    if (!event.body) return { statusCode: 400, headers, body: JSON.stringify({ error: "Request body is empty" }) };

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Server Config Error: API Key missing" }) };

    // --- 3. 入力データの厳格なバリデーション ---
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON format" }) };
    }

    // 入力チェック: contentsが存在するか
    if (!requestBody.contents || !Array.isArray(requestBody.contents)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid payload: 'contents' array is required." }) };
    }

    // 入力チェック: 文字数が多すぎないか (DoS攻撃/コスト対策)
    const inputString = JSON.stringify(requestBody.contents);
    if (inputString.length > MAX_PROMPT_LENGTH) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Payload too large: Prompt exceeds character limit." }) };
    }

    // --- 4. リクエスト構築 ---
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const finalRequestBody = {
        contents: requestBody.contents,
        // 安全設定（完全開放）
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        // 生成設定（フロントエンドからの指定を優先、なければデフォルト）
        generationConfig: {
            maxOutputTokens: 8192,
            temperature: requestBody.generationConfig?.temperature ?? 0.7,
            responseMimeType: "application/json",
            ...(requestBody.generationConfig?.responseSchema ? { responseSchema: requestBody.generationConfig.responseSchema } : {})
        },
        // システム指示
        ...(requestBody.systemInstruction ? { systemInstruction: requestBody.systemInstruction } : {})
    };

    // --- 5. リトライ付きフェッチ処理 ---
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // signal: controller.signal を渡すことで、タイムアウト時に通信をキャンセルできる
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalRequestBody),
          signal: controller.signal 
        });

        if (response.ok) {
          clearTimeout(timeoutId); // 成功したらタイマー解除
          const data = await response.json();
          return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        // エラー処理
        const errorText = await response.text();
        const status = response.status;

        // 400番台は即終了
        if (status >= 400 && status < 500 && status !== 429) {
          clearTimeout(timeoutId);
          console.error(`Gemini Client Error: ${status} ${errorText}`);
          return { statusCode: status, headers, body: JSON.stringify({ error: `AI Service Error: ${errorText}` }) };
        }

        throw new Error(`Upstream ${status}: ${errorText}`);

      } catch (error) {
        // ★タイムアウトエラーの検知
        if (error.name === 'AbortError') {
          console.error("Request timed out by Server Limit");
          return { 
            statusCode: 504, // Gateway Timeout
            headers, 
            body: JSON.stringify({ error: "Time limit exceeded. The AI took too long to respond." }) 
          };
        }

        lastError = error;
        console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);

        // 最後の試行でなければ待機 (ただし残り時間が少ないなら待機しない)
        if (attempt < MAX_RETRIES - 1) {
          await sleep(INITIAL_DELAY_MS * Math.pow(2, attempt));
        }
      }
    }

    clearTimeout(timeoutId);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Failed to communicate with AI service.", details: lastError.message }),
    };

  } catch (globalError) {
    // 万が一の未知のエラー
    clearTimeout(timeoutId);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: "Internal Server Error", details: globalError.message }),
    };
  }
};