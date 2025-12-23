exports.handler = async function(event, context) {
  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: "Request body is empty" }) };
  }

  let requestBody;
  try {
    requestBody = JSON.parse(event.body);
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
  }

  // ★★★ APIキー ★★★
  // 【推奨】Netlifyの管理画面で "GEMINI_API_KEY" という環境変数を設定し、
  // 下の行を const apiKey = process.env.GEMINI_API_KEY; に書き換えてください。
  const apiKey = process.env.GOOGLE_API_KEY; 

  // ★★★ 変更点：ここを 2.5 から 2.0 に変更しました ★★★
  // エイリアスではなく、具体的なバージョン名を指定
// ★★★ 20回制限ですが、最新で性能が良い 2.5 Flash に戻します ★★★
const modelName = "gemini-2.5-flash";
   
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

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

  const finalRequestBody = {
      ...requestBody,
      safetySettings: safetySettings,
      generationConfig: generationConfig
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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