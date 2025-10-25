// netlify/functions/utils.js

/**
 * リトライ機能付きでGoogle AI APIを呼び出す
 */
export async function fetchWithRetry(payload, maxRetries = 3) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not defined.");
    
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' + apiKey;
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok) return response;
            // (エラーハンドリングはご自身のコードに合わせて調整してください)
            lastError = new Error(`API Error: ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        if (i < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
    throw lastError;
}

/**
 * AIからの応答テキストからJSONオブジェクトを安全に抽出する
 */
export function parseJsonFromText(text) {
    try {
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error("Failed to parse JSON from text:", text, e);
    }
    return null;
}