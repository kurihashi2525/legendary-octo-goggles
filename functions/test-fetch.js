// functions/test-fetch.js
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  console.log("test-fetch invoked!"); // 関数が呼ばれたことをログに出力
  try {
    // 簡単なテスト用ウェブサイトにアクセスしてみる
    const response = await fetch('https://httpbin.org/get'); // ダミーのURLにアクセス
    if (!response.ok) {
      throw new Error(`Fetch failed with status: ${response.status}`);
    }
    const data = await response.json();
    console.log("Fetch successful:", data.url); // 成功したらログに出力
    // ブラウザに成功メッセージを返す
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "node-fetch test successful!", url: data.url }),
    };
  } catch (error) {
    console.error("Error in test-fetch:", error); // エラーが出たらログに出力
    // ブラウザにエラーメッセージを返す
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};