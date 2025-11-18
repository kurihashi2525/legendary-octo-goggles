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

  const apiKey = process.env.GOOGLE_API_KEY;
  
  // ★画像生成モードの場合の処理を追加
  if (requestBody.mode === 'image') {
    // Imagen 3 (または利用可能な画像モデル) のエンドポイント
    // ※Google AI Studioで画像生成が有効化されている必要があります
    const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${apiKey}`;
    
    const imageRequestBody = {
        instances: [
            { prompt: requestBody.prompt }
        ],
        parameters: {
            sampleCount: 1,
            aspectRatio: "3:4" // 新聞っぽい縦横比
        }
    };

    try {
        const response = await fetch(imageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(imageRequestBody),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            return { statusCode: response.status, body: JSON.stringify({ error: `Image Gen Error: ${errorBody}` }) };
        }

        const data = await response.json();
        // Imagenのレスポンス形式に合わせてBase64を取得
        const base64Image = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.bytes;

        return {
            statusCode: 200,
            body: JSON.stringify({ image: base64Image })
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // 安全フィルターを無効化
  const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
  ];

  // ★★★ 生成設定を追加 (ここが修正ポイント) ★★★
  const generationConfig = {
      maxOutputTokens: 8192,       // 文字数制限を大幅に増やす (デフォルトだと短くて切れることがある)
      responseMimeType: "application/json" // AIに「必ずJSONとして出力しろ」と強制する (1.5/2.5系で有効)
  };

  // リクエストボディに設定をマージする
  const finalRequestBody = {
      ...requestBody,
      safetySettings: safetySettings,
      generationConfig: generationConfig // ★追加
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