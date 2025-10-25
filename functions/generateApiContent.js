// functions/generateApiContent.js (Final Approach: export default + manual stream piping)
const fetch = require('node-fetch');
// ReadableStream and TextEncoder/Decoder are usually globally available in modern Node envs Netlify uses for this format
// const { TransformStream } = require('node:stream/web'); // Likely not needed here
// const { Readable } = require('stream'); // Likely not needed here

export default async (request, context) => {
    console.log("generateApiContent (export default - manual pipe) invoked.");
    let apiKey;
    try {
        const requestBody = await request.json();
        apiKey = process.env.GOOGLE_API_KEY;

        if (!apiKey) { throw new Error("API Key is not configured."); }
        console.log("API Key loaded (first 5):", apiKey.substring(0, 5));

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

        console.log("Calling Google API:", apiUrl);
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        console.log("Google API status:", geminiResponse.status);

        if (!geminiResponse.ok || !geminiResponse.body) {
            const errorBody = await geminiResponse.text();
            throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
        }
        console.log("Google API OK. Setting up manual stream pipe.");

        // ★★★ 手動でのストリーム制御 ★★★
        const nodeReadableStream = geminiResponse.body; // node-fetch v2 stream
        let streamErrored = false; // エラーフラグ

        // 新しい ReadableStream を作成し、これを Response で返す
        const webReadableStream = new ReadableStream({
            async start(controller) {
                let buffer = ''; // 不完全なチャンク用バッファ
                const decoder = new TextDecoder();
                const encoder = new TextEncoder();

                nodeReadableStream.on('data', (chunk) => {
                    try {
                        const text = buffer + decoder.decode(chunk); // Bufferをデコード
                        const lines = text.split('\n');
                        buffer = lines.pop() || ''; // 最後の不完全な行を保存

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const jsonChunk = line.substring(6).trim();
                                if (jsonChunk) {
                                    try {
                                        const parsedChunk = JSON.parse(jsonChunk);
                                        if (parsedChunk.candidates && parsedChunk.candidates[0].content) {
                                            const contentPart = parsedChunk.candidates[0].content.parts[0].text;
                                            controller.enqueue(encoder.encode(contentPart)); // テキスト部分だけを送る
                                        }
                                    } catch (e) {
                                        console.warn("Manual pipe: Skipping invalid JSON chunk:", jsonChunk, e);
                                    }
                                }
                            }
                        }
                    } catch (err) {
                         console.error("Manual pipe: Error processing data chunk:", err);
                         controller.error(err); // エラーをコントローラーに通知
                         streamErrored = true;
                         nodeReadableStream.destroy(); // 元のストリームを閉じる
                    }
                });

                nodeReadableStream.on('end', () => {
                    if (streamErrored) return; // エラー発生時は何もしない
                    try {
                        // 最後にバッファに残ったデータを処理
                         if (buffer.startsWith('data: ')) {
                             const jsonChunk = buffer.substring(6).trim();
                             if (jsonChunk) {
                                 const parsedChunk = JSON.parse(jsonChunk);
                                 if (parsedChunk.candidates && parsedChunk.candidates[0].content) {
                                     const contentPart = parsedChunk.candidates[0].content.parts[0].text;
                                     controller.enqueue(encoder.encode(contentPart));
                                 }
                             }
                         }
                        console.log("Manual pipe: Node stream ended. Closing web stream.");
                        controller.close(); // Webストリームを閉じる
                    } catch (err) {
                         console.error("Manual pipe: Error processing final buffer:", err);
                         controller.error(err);
                    }
                });

                nodeReadableStream.on('error', (err) => {
                    console.error("Manual pipe: Node stream errored:", err);
                    controller.error(err); // Webストリームにもエラーを伝える
                    streamErrored = true;
                });
            }
        });
        // ★★★ 手動制御ここまで ★★★

        console.log("Manual stream pipe set up. Returning Response object.");
        return new Response(webReadableStream, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });

    } catch (error) {
        console.error("Error in Netlify function:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};