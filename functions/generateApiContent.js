// netlify/functions/generateApiContent.js

exports.handler = async function(event, context) {
  const requestBody = JSON.parse(event.body);
  const apiKey = process.env.GOOGLE_API_KEY;

  // 1. エンドポイントを ":streamGenerateContent" に変更
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;

  // 2. Google APIにリクエストを送信
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  // 3. Googleからのストリーミング応答を、そのままフロントエンドに返す
  //    Netlifyが自動的にストリームとして処理してくれます。
  return {
    statusCode: 200,
    headers: { 
      "Content-Type": "application/json", // データ形式に合わせて設定
    },
    body: response.body,
  };
};