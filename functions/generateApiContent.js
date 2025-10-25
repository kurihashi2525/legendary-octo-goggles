// functions/generateApiContent.js (Refined stream handling with export default)
const fetch = require('node-fetch');
const { TransformStream } = require('node:stream/web');
const { Readable } = require('stream');

// ★★★ 修正版 createTransformStream ★★★
// より堅牢にJSONチャンクを抽出・処理する
const createTransformStream = () => {
    let buffer = ''; // 不完全なチャンクを一時保存するバッファ
    return new TransformStream({
        transform(chunk, controller) {
            const text = buffer + new TextDecoder().decode(chunk); // 前回の残り物と結合
            const lines = text.split('\n');
            buffer = lines.pop() || ''; // 最後の不完全な行を次のために保存

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonChunk = line.substring(6).trim(); // "data: " を削除
                    if (jsonChunk) { // 空のチャンクは無視
                        try {
                            // Google AIからの各チャンクは独立したJSONオブジェクトを含むことがある
                            // チャンク自体をエンキューするのではなく、チャンク内のテキスト部分を抽出して送る
                            const parsedChunk = JSON.parse(jsonChunk);
                            if (parsedChunk.candidates && parsedChunk.candidates[0].content) {
                                 const contentPart = parsedChunk.candidates[0].content.parts[0].text;
                                 // ★★★ JSONオブジェクトではなく、テキスト部分だけを送る ★★★
                                 controller.enqueue(new TextEncoder().encode(contentPart));
                            }
                        } catch (e) {
                            console.warn("Skipping invalid JSON chunk:", jsonChunk, e);
                            // 不正なJSONチャンクは無視
                        }
                    }
                }
            }
        },
        flush(controller) {
            // ストリーム終了時にバッファに残っているものを処理 (通常は空のはず)
            if (buffer.startsWith('data: ')) {
                const jsonChunk = buffer.substring(6).trim();
                if (jsonChunk) {
                     try {
                         const parsedChunk = JSON.parse(jsonChunk);
                         if (parsedChunk.candidates && parsedChunk.candidates[0].content) {
                             const contentPart = parsedChunk.candidates[0].content.parts[0].text;
                             controller.enqueue(new TextEncoder().encode(contentPart));
                         }
                     } catch (e) {
                         console.warn("Skipping invalid JSON chunk at flush:", jsonChunk, e);
                     }
                }
            }
        }
    });
};
// ★★★ 修正ここまで ★★★

export default async (request, context) => {
    console.log("generateApiContent (export default - refined stream) invoked.");
    let apiKey;
    try {
        const requestBody = await request.json();
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

        // ★★★ 修正版 createTransformStream を使用 ★★★
        const nodeReadableStream = geminiResponse.body;
        const webTransformStream = createTransformStream(); // 修正版を呼び出し
        const webReadableStream = Readable.toWeb(nodeReadableStream).pipeThrough(webTransformStream);
        // ★★★ 修正ここまで ★★★

        // ★ Response オブジェクトで返す (ヘッダーを 'text/plain' に変更) ★
        return new Response(webReadableStream, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }, // テキストとして返す
        });

    } catch (error) {
        console.error("Error in Netlify function:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};