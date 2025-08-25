// netlify/functions/generate-voice.js

// VOICEVOX APIと通信するためのライブラリをインポート
const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    try {
        // ブラウザから送られてきたテキストを取得
        const { text, speakerId } = JSON.parse(event.body);

        // VOICEVOXエンジンのアドレス
        const voicevoxEngineUrl = 'http://127.0.0.1:50021';

        // --- ステップ1: audio_query (音声合成用のクエリを作成) ---
        const audioQueryResponse = await fetch(
            `${voicevoxEngineUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
            { method: 'POST' }
        );
        if (!audioQueryResponse.ok) {
            throw new Error(`Audio query failed: ${await audioQueryResponse.text()}`);
        }
        const audioQuery = await audioQueryResponse.json();
        
        // --- ステップ2: synthesis (クエリを元に音声(WAV)を合成) ---
        const synthesisResponse = await fetch(
            `${voicevoxEngineUrl}/synthesis?speaker=${speakerId}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(audioQuery)
            }
        );

        if (!synthesisResponse.ok) {
            throw new Error(`Synthesis failed: ${await synthesisResponse.text()}`);
        }

        // 音声データをBuffer形式で取得し、Base64文字列に変換
        const audioBuffer = await synthesisResponse.buffer();
        const audioBase64 = audioBuffer.toString('base64');

        // Base64に変換した音声データをブラウザに返す
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioData: audioBase64 }),
        };

    } catch (error) {
        console.error('Error generating voice:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};