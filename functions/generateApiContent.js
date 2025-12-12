// netlify/functions/generateApiContent.js

exports.handler = async function(event, context) {
  // 1. リクエストBodyが空の場合はエラーを返す
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request body is empty" }),
    };
  }

  let requestBody;
  try {
    // 2. JSONパース
    requestBody = JSON.parse(event.body);
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON format" }),
    };
  }

  // ★★★ APIキーを設定しました ★★★
  const apiKey = "AIzaSyDJisMT_ddyr-rXw7v972o_n3DsFCI-8N8"; 

  // ★★★ モデルを制限の緩い「gemini-1.5-flash」に固定しました ★★★
  // (1日1500回まで無料で使えます)
  const modelName = "gemini-1.5-flash";
  
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  // 安全フィルターを無効化（ゲーム内の表現がブロックされないように）
  const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
  ];

  const generationConfig = {
      maxOutputTokens: 8192,
      responseMimeType: "application/json"
  };

  // リクエストボディに設定をマージする
  const finalRequestBody = {
      ...requestBody,
      safetySettings: safetySettings,
      generationConfig: generationConfig
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(finalRequestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Google API Error: ${errorBody}` }),
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};