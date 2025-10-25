// netlify/functions/request-generation.js

import { getBlobs } from "@netlify/blobs";
import { BackgroundFunctions } from "@netlify/functions";

export default async (req) => {
    // ブラウザから matchContext を受け取る
    const { generationType, context } = await req.json();

    // ユニークな整理券番号(jobId)を発行
    const jobId = crypto.randomUUID();

    // 料理人(バックグラウンド関数)を呼び出す
    await BackgroundFunctions.invoke("process-generation-background", {
        body: JSON.stringify({ jobId, generationType, context }),
    });

    // すぐに整理券番号をブラウザに返す
    return new Response(JSON.stringify({ jobId }));
};