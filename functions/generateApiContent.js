// functions/generateApiContent.js (Final attempt: exports.handler + refined stream handling)
const fetch = require('node-fetch');
const { TransformStream } = require('node:stream/web');
const { Readable } = require('stream');

// ★ 修正版 createTransformStream (変更なし) ★
const createTransformStream = () => {
    let buffer = '';
    return new TransformStream({
        transform(chunk, controller) {
            const text = buffer + new TextDecoder().decode(chunk);
            const lines = text.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonChunk = line.substring(6).trim();
                    if (jsonChunk) {
                        try {
                            const parsedChunk = JSON.parse(jsonChunk);
                            if (parsedChunk.candidates && parsedChunk.candidates[0].content) {
                                const contentPart = parsedChunk.candidates[0].content.parts[0].text;
                                controller.enqueue(new TextEncoder().encode(contentPart));
                            }
                        } catch (e) { console.warn("Skipping invalid JSON chunk:", jsonChunk, e); }
                    }
                }
            }
        },
        flush(controller) { /* ... (flush処理は元のまま) ... */ }
    });
};

// ★ exports.handler 形式に戻す ★
exports.handler = async function(event, context) {
    console.log("generateApiContent (exports.handler - final attempt) invoked.");
    let apiKey;
    try {
        const requestBody = JSON.parse(event.body || '{}');
        apiKey = process.env.GOOGLE_API_KEY;

        if (!apiKey) { throw new Error("API Key is not configured."); }
        console.log("API Key loaded (first 5):", apiKey.substring(0, 5));

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!geminiResponse.ok || !geminiResponse.body) {
            const errorBody = await geminiResponse.text();
            throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
        }

        const nodeReadableStream = geminiResponse.body;
        const webTransformStream = createTransformStream();
        const webReadableStream = Readable.toWeb(nodeReadableStream).pipeThrough(webTransformStream);

        console.log("Stream ready. Returning stream body.");
        // ★ exports.handler 形式でストリームを返す ★
        // Netlify Functions (Node.js) は Web ReadableStream を直接 body にできる
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8', // テキストストリームとして返す
                'Transfer-Encoding': 'chunked'
             },
            body: webReadableStream, // Web ReadableStream を直接 body に設定
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