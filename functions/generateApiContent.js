// netlify/functions/generateApiContent.js

exports.handler = async function(event, context) {
  try {
    // Googleには接続せず、単純な成功メッセージを返すだけのテスト
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: "テスト成功！Netlify Functionは正常に動作しています。" 
      }),
    };
  } catch (error) {
    // もしこれでもエラーが出た場合
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `関数でエラーが発生しました: ${error.message}` }),
    };
  }
};