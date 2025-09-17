// netlify/functions/generateApiContent.js

exports.handler = async function(event, context) {
  const requestBody = JSON.parse(event.body);
  const apiKey = process.env.GOOGLE_API_KEY;

  // ストリーミング用のエンドポイント
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // ▼▼▼【重要】ここからが追加されたエラーハンドリングです ▼▼▼
    // もしGoogleのAIサーバーからエラーが返ってきた場合...
    if (!response.ok) {
      // エラーの内容を読み取って、フロントエンドにちゃんと伝える
      const errorBody = await response.text();
      console.error("Google API Error:", errorBody);
      return {
        statusCode: response.status, // Googleからのエラーコードをそのまま使う
        body: JSON.stringify({ error: `Google API Error: ${errorBody}` }),
      };
    }
    // ▲▲▲ エラーハンドリングここまで ▲▲▲

    // 成功した場合、ストリームをそのままフロントエンドに返す
    return {
      statusCode: 200,
      headers: { 
        "Content-Type": "application/json",
      },
      body: response.body,
    };

  } catch (error) {
    // 予期せぬエラーが発生した場合
    console.error("Netlify Function Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};