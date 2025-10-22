// functions/generateApiContent.js

// Googleからのストリーミングデータをクライアントに送信できる形式に変換するヘルパー
const createTransformStream = () => {
  return new TransformStream({
    transform(chunk, controller) {
      // 受け取ったデータチャンクをテキストとしてデコード
      const text = new TextDecoder().decode(chunk);
      // Googleからのストリーミングデータは "data: { ...JSON... }" という形式なので、
      // "data: " の部分を取り除き、中身のJSONだけをクライアントに送る
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          // JSONデータ部分だけをエンコードしてキューに入れる
          controller.enqueue(new TextEncoder().encode(line.substring(6)));
        }
      }
    }
  });
};

export default async (request) => {
  try {
    // フロントエンドから送られてきたリクエストボディを取得
    const requestBody = await request.json();
    const apiKey = process.env.GOOGLE_API_KEY;
    
    // Google AIの「ストリーミング生成」用のAPIエンドポイントURL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

    // GoogleのAPIにストリーミングリクエストを送信
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Googleからの応答がストリーミング可能でなければエラー
    if (!geminiResponse.ok || !geminiResponse.body) {
      const errorBody = await geminiResponse.text();
      throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
    }

    // Googleからのストリームを、クライアントに送信できる形式に変換
    const transformStream = createTransformStream();
    const readableStream = geminiResponse.body.pipeThrough(transformStream);

    // クライアントにストリーミング応答を返す
    return new Response(readableStream, {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Netlify Function Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Netlifyにこの関数がストリーミングを優先することを伝える設定
export const config = {
  path: "/.netlify/functions/generateApiContent",
  prefer_streaming: true,
};