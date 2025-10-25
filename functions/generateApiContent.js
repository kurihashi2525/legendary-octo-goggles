// functions/generateApiContent.js (Non-streaming test with node-fetch v2)
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    console.log("generateApiContent (non-streaming test) invoked.");
    let apiKey;
    try {
        const requestBody = JSON.parse(event.body || '{}');
        apiKey = process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            console.error("GOOGLE_API_KEY is missing!");
            throw new Error("API Key is not configured.");
        }
        console.log("API Key loaded (first 5):", apiKey.substring(0, 5));
        console.log("Request body:", JSON.stringify(requestBody).substring(0, 100) + "...");

        // *** ストリーミングではない GenerateContent エンドポイントを使用 ***
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        console.log("Calling Google API (non-streaming):", apiUrl);
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody), // Send the original payload
        });
        console.log("Google API response status:", geminiResponse.status);

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.text();
            console.error("Google API Error:", geminiResponse.status, errorBody);
            throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
        }

        // *** 完全なJSON応答を取得 ***
        const data = await geminiResponse.json();
        console.log("Google API response received successfully.");

        // 完全なJSONを文字列にして返す (exports.handler の標準的な返し方)
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data), // 完全なJSON文字列を返す
            isBase64Encoded: false
        };

    } catch (error) {
        console.error("Error caught in Netlify function:", error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message }),
        };
    }
};