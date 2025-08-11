// Google CloudのAI機能を呼び出すためのライブラリを読み込み
const { VertexAI } = require('@google-cloud/vertex-ai');

exports.handler = async (event) => {
  // CORS preflight request handling
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // Frontendから送られてきたデータ（プロンプトなど）を取得
  const { prompt } = JSON.parse(event.body);

  if (!prompt) {
    return { statusCode: 400, body: 'Error: No prompt provided' };
  }

  // Vertex AIの初期設定
  const vertex_ai = new VertexAI({
    project: process.env.GOOGLE_PROJECT_ID, // 環境変数からプロジェクトIDを取得
    location: 'asia-northeast1', // 東京リージョン
  });

  const model = 'imagegeneration@0.0.5'; // Imagen 2のモデル

  const generativeModel = vertex_ai.getGenerativeModel({
    model: model,
  });

  try {
    // 画像生成AIに、受け取ったプロンプトで画像を1枚生成するように依頼
    const resp = await generativeModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generation_config: {
        "number_of_images": 1
      }
    });

    // AIからの応答を取得
    const responseData = await resp.response;
    // 生成された画像のデータ(b64Json)を取得
    const imageBase64 = responseData.candidates[0].content.parts[0].file_data.data;
    // Base64形式の画像データを、ブラウザで表示できる形式に変換
    const imageUrl = `data:image/png;base64,${imageBase64}`;

    // ブラウザに画像データを返す
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: imageUrl }),
    };

  } catch (error) {
    console.error('Error generating image:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to generate image.' }),
    };
  }
};