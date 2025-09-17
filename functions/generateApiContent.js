// netlify/functions/generateApiContent.js

exports.handler = async function(event, context) {
  const requestBody = JSON.parse(event.body);
  const apiKey = process.env.GOOGLE_API_KEY;

  // ★★★ モデル名を「1.5」に変更してテスト ★★★
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${apiKey}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Google API Error:", errorBody);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Google API Error: ${errorBody}` }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: response.body,
    };

  } catch (error) {
    console.error("Netlify Function Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};