// netlify/functions/generateApiContent.js

exports.handler = async function(event, context) {
  // フロントエンドから送られてきたデータ（プロンプトなど）を取得
  const requestBody = JSON.parse(event.body);

  // 環境変数から安全にAPIキーを読み込む
  const apiKey = process.env.GOOGLE_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

  try {
    // GoogleのAPIサーバーにリクエストを転送
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody), // フロントエンドからのリクエスト内容をそのまま送る
    });

    if (!response.ok) {
      // エラーハンドリング
      const errorBody = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Google API Error: ${errorBody}` }),
      };
    }

    const data = await response.json();

    // 成功した結果をフロントエンドに返す
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