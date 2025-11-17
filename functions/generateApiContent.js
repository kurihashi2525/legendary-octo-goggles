// netlify/functions/generateApiContent.js

const ALLOWED_ORIGIN = "https://peppy-bombolone-94f3a7.netlify.app";
const INITIAL_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.handler = async function(event, context) {
  // 1. CORS & Method Check
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  if (!event.body) return { statusCode: 400, headers, body: JSON.stringify({ error: "Request body is empty" }) };

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "API Key missing" }) };

  let requestBody;
  try {
    requestBody = JSON.parse(event.body);
  } catch (error) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON format" }) };
  }

  // 最新モデル
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // ★★★ 強化ポイント：リクエスト構築のロジック ★★★
  
  // 1. 安全設定（野球用語が誤検知されないよう全開放）
  const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
  ];

  // 2. 生成設定（スキーマがあれば適用する）
  const generationConfig = {
      maxOutputTokens: 8192,
      temperature: requestBody.generationConfig?.temperature ?? 0.7, // フロントから指定がなければ0.7
      responseMimeType: "application/json",
  };

  // ★スキーマ（responseSchema）が送られてきている場合はセットする
  if (requestBody.generationConfig?.responseSchema) {
      generationConfig.responseSchema = requestBody.generationConfig.responseSchema;
      // スキーマを使うときは responseMimeType は application/json 必須
      generationConfig.responseMimeType = "application/json";
  }

  // 3. 最終的なリクエストボディ
  const finalRequestBody = {
      contents: requestBody.contents,
      safetySettings: safetySettings,
      generationConfig: generationConfig,
  };

  // ★システム指示（systemInstruction）があれば追加
  // これにより「あなたは記者です」という設定が揺らがなくなる
  if (requestBody.systemInstruction) {
      finalRequestBody.systemInstruction = requestBody.systemInstruction;
  }

  // リトライ処理
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalRequestBody),
      });

      if (response.ok) {
        const data = await response.json();
        return { statusCode: 200, headers, body: JSON.stringify(data) };
      }

      const status = response.status;
      const errorText = await response.text();

      // 400番台はリトライ不可（データがおかしい）
      if (status >= 400 && status < 500 && status !== 429) {
        console.error(`Gemini API Error: ${status} ${errorText}`);
        return { statusCode: status, headers, body: JSON.stringify({ error: errorText }) };
      }
      throw new Error(`Upstream Error ${status}: ${errorText}`);

    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1) await sleep(INITIAL_DELAY_MS * Math.pow(2, attempt));
    }
  }

  return {
    statusCode: 502,
    headers,
    body: JSON.stringify({ error: "Failed after retries", details: lastError.message }),
  };
};