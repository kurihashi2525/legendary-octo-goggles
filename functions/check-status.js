// netlify/functions/check-status.js

import { getBlobs } from "@netlify/blobs";

export default async (req) => {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");
    const blobs = getBlobs("ai-results");

    // 整理券番号を基に保管場所を確認
    const result = await blobs.getJSON(jobId);

    if (result) {
        // 結果が見つかったら、保管場所から削除してブラウザに返す
        await blobs.delete(jobId);
        return new Response(JSON.stringify(result));
    } else {
        // まだ結果がなければ、「調理中」と返す
        return new Response(JSON.stringify({ status: "pending" }));
    }
};