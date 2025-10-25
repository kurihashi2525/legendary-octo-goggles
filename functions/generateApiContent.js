// functions/generateApiContent.js (一時的なテストコード)
const fetch = require('node-fetch'); // node-fetch を読み込むだけ

exports.handler = async function(event, context) {
  console.log("generateApiContent (test code) invoked!");
  try {
    // test-fetch.js と同じように簡単なアクセスを試す
    const response = await fetch('https://httpbin.org/get');
    if (!response.ok) {
      throw new Error(`Fetch failed with status: ${response.status}`);
    }
    const data = await response.json();
    console.log("Fetch successful in generateApiContent (test code):", data.url);
    // ブラウザには成功メッセージだけ返す
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "generateApiContent CAN require node-fetch!" }),
    };
  } catch (error) {
    console.error("Error in generateApiContent (test code):", error);
    // エラーを返す
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};