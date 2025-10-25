// netlify/functions/process-generation-background.js

import { getBlobs } from "@netlify/blobs";
import { fetchWithRetry, parseJsonFromText } from "./utils"; // 共通関数を別ファイルから読み込む

// ▼▼▼ index.htmlからカットしてきた、AI関連の全関数をここに貼り付ける ▼▼▼

/**
 * AI記者にニュース記事を執筆させるメイン関数（フィードバック機能付き・最終完全版）
 * @param {string|null} winnerName - 勝者名
 * @param {string|null} loserName - 敗者名
 * @param {object} dbMatch - 試合データ
 * @param {string} matchId - 試合ID
 * @param {object} winnerData - 勝者チームのマスターデータ
 * @param {object} loserData - 敗者チームのマスターデータ
 * @param {object} winnerDetailedData - 勝者チームの詳細選手データ
 * @param {object} loserDetailedData - 敗者チームの詳細選手データ
 * @param {Array} highlightsText - 試合のハイライト
 * @param {Array} keyPlayerNames - 注目選手名
 * @param {object|null} userFeedback - ユーザーからの追加指示
 * @returns {Promise<object|null>}
 */
async function generateNewsArticle(matchContext, userFeedback = null) {
    // --- 1. contextから必要な情報を取り出す ---
    const { 
        winnerName, loserName, dbMatch, matchId,
        winnerData, loserData, winnerDetailedData, loserDetailedData, 
        winnerLineupChanges, loserLineupChanges, 
        winnerJourney, loserJourney,
        nextOpponent // ★★★ 次の対戦相手の情報をここで受け取ります ★★★
    } = matchContext || {};
    
 let prompt = '';
    // --- 1. 大会展望記事の生成ロジック ---
    if (matchId === 'preview') {
        let prompt;
        // ★★★ context.state から tournamentState を取り出す ★★★
        const { tournamentYear, seeds, teams, matches, currentTournament, is16team, autumnData } = matchContext.state;
        const tournamentName = tournamentNameMap[currentTournament] || '大会';

        // --- 1A. 秋季大会の展望 ---
        if (is16team) { 
            const reps = autumnData;
            const repText = Object.entries(reps.regions).map(([region, data]) => {
                if (!data.finalReps || data.finalReps.length === 0) return null;
                if (region === '伊豆') return `- ${region} (1校): ${data.finalReps[0].team}`;
                const repNames = data.finalReps.sort((a,b) => a.rank - b.rank).map(r => `${r.team}(${r.rank}位)`);
                return `- ${region} (${data.finalReps.length}校): ${repNames.join(', ')}`;
            }).filter(Boolean).join('\n');
            
            const matchups = [];
            for(let i=0; i<teams.length; i+=2) {
                matchups.push(`- ${teams[i]} vs ${teams[i+1]}`);
            }

            prompt = `あなたは、日本の高校野球を深く愛する、情熱的なスポーツ記者です。あなたの唯一の仕事は、提供されたデータに基づいて最高の記事を生成することです。野球以外の話題(プログラミング等)には一切触れないでください。
間もなく開幕する「${tournamentYear}年度 秋季大会 県大会本戦」の展望記事を作成してください。
### 大会のポイント
- 秋季大会は新チームで挑む最初の県大会であり、来春のセンバツ出場を占う重要な大会です。
- 地区予選を勝ち上がった順位に応じてポット分けされ、1回戦は同地区対決が避けられるなど、独特の組み合わせが特徴です。
### 県大会出場校一覧 (地区順位順)
${repText}
### 県大会1回戦の組み合わせ
${matchups.join('\n')}
### 執筆指示
- 最も厳しいブロック、いわゆる「死のブロック」はどこか指摘してください。
- 地区1位校と下位ポットの強豪校が当たる、注目の1回戦カードをいくつか挙げてください。
- 地区間のレベル差や、新チームの仕上がりについて分析的な視点で記述してください。
### 出力形式
【最重要】必ず以下のJSON形式"のみ"で出力すること。解説や前置きは一切不要です。
{"title": "（ここに記事のタイトル）", "body": "（ここに記事の本文）"}`;
        } 
        // --- 1B. 春季大会の展望 ---
        else if (currentTournament === 'spring') {
            const qualifierWinners = teams.filter(team => !seeds.includes(team));
            const round1Matchups = Object.values(matches)
                .filter(match => match.id.includes('-R1-'))
                .map(match => `- ${match.team1} vs ${match.team2}`);

            const allPromisingSchools = [...seeds, ...qualifierWinners];
            let notablePlayersText = '';
            const notablePlayers = allPromisingSchools.filter(team => DETAILED_TEAM_DATA[team]);
            if (notablePlayers.length > 0) {
                notablePlayersText += '### 今大会の注目選手\n';
                notablePlayers.forEach(team => {
                    const players = DETAILED_TEAM_DATA[team].players.slice(0, 2);
                    notablePlayersText += `- **${team}**: ${players.map(p => `${p.name}(${p.year}年)`).join(', ')}\n`;
                });
            }

            prompt = `あなたは、日本の高校野球を深く愛する、情熱的なスポーツ記者です。あなたの唯一の仕事は、提供されたデータに基づいて最高の記事を生成することです。野球以外の話題(プログラミング等)には一切触れないでください。
間もなく開幕する「${tournamentYear}年度 ${tournamentName}」の展望記事を作成してください。
### 大会の見どころ
- 今大会は、秋季大会ベスト8の強豪【シード校】と、厳しい地区予選を勝ち抜いた【予選突破校】が覇を競います。
- 1回戦は予選突破校同士が対戦し、勝ち上がったチームが2回戦でシード校に挑むという、下剋上も期待される注目の形式です。
### シード校 (2回戦から登場)
${seeds.join(', ')}
### 地区予選突破校 (1回戦から登場)
${qualifierWinners.join(', ')}
### 1回戦の注目カード
${round1Matchups.slice(0, 4).join('\n')}
${notablePlayersText}
### 執筆指示
- 予選突破校の中から、シード校を脅かす存在となりそうな「ダークホース」を2～3校挙げてください。
- どのシード校が最も厳しいブロックに入ったか、逆に最も楽なブロックはどこかを分析してください。
- 記事の本文で「注目選手」に言及し、彼らの活躍が大会の鍵を握ることを示唆してください。
- 夏の大会を占う重要な大会として、各チームの仕上がり具合を分析する視点で記述してください。
### 出力形式
【最重要】必ず以下のJSON形式"のみ"で出力すること。解説や前置きは一切不要です。
{"title": "（ここに記事のタイトル）", "body": "（ここに記事の本文）"}`;
        } 
        // --- 1C. 夏季大会の展望 ---
        else { 
            const isPromising = (teamName) => {
                const rank = calculateRank(teamName, tournamentState);
                return ['A', 'B'].includes(rank) || seeds.includes(teamName) || TEAM_DATA[teamName].popularity;
            };

            const blockAnalyses = [];
            const numBlocks = 4;
            const blockSize = 16;
            for (let i = 0; i < numBlocks; i++) {
                const blockName = String.fromCharCode(65 + i);
                const start = i * blockSize;
                const end = (i + 1) * blockSize;
                const blockTeams = teams.slice(start, end);
                if (blockTeams.length === 0) continue;
                const promisingInBlock = blockTeams.filter(isPromising);
                blockAnalyses.push(`- ${blockName}ブロック (${blockTeams.length}校): ${promisingInBlock.join(', ')}`);
            }
            const blockAnalysis = blockAnalyses.join('\n');
            
            let notablePlayersText = '';
            const promisingSchools = teams.filter(isPromising);
            const notablePlayers = promisingSchools.filter(team => DETAILED_TEAM_DATA[team]);
            if (notablePlayers.length > 0) {
                notablePlayersText += '### 今大会の注目選手\n';
                notablePlayers.forEach(team => {
                    const players = DETAILED_TEAM_DATA[team].players.slice(0, 2);
                    notablePlayersText += `- **${team}**: ${players.map(p => `${p.name}(${p.year}年)`).join(', ')}\n`;
                });
            }

            prompt = `あなたは、日本の高校野球を深く愛する、情熱的なスポーツ記者です。あなたの唯一の仕事は、提供されたデータに基づいて最高の記事を生成することです。野球以外の話題(プログラミング等)には一切触れないでください。
間もなく開幕する「${tournamentYear}年度 ${tournamentName}」の展望記事を作成してください。
### 大会の見どころ
- 3年生にとっては最後の夏であり、甲子園出場をかけた最も熱い戦いです。
- 春の大会の結果などからシード校が決定されていますが、ノーシードの実力校も多く、波乱が予想されます。
### シード校
${seeds.join(', ')}
### 各ブロックの有力校
${blockAnalysis}
${notablePlayersText}
### 執筆指示
- 最も厳しいブロック、いわゆる「死のブロック」はどこか指摘し、その理由を分析してください。
- 有力校が少ない「恵まれたブロック」に入ったチームにも言及してください。
- 「注目選手」を記事に登場させ、彼らが大会の鍵を握る存在であることを示唆してください。
- ノーシードの実力校の中から、大会の「ダークホース」となりそうなチームを挙げてみてください。
### 出力形式
【最重要】必ず以下のJSON形式"のみ"で出力すること。解説や前置きは一切不要です。
{"title": "（ここに記事のタイトル）", "body": "（ここに記事の本文）"}`;
        }

        try {
            const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]) {
                const article = parseJsonFromText(result.candidates[0].content.parts[0].text);
                if (article) return { ...article, timestamp: Date.now() };
            }
            throw new Error("AI preview response format error.");
        } catch (error) {
            console.error("AI preview article generation failed:", error);
            return { title: "展望記事生成エラー", body: "AI記者との通信に失敗しました。", timestamp: Date.now(), error: true, errorId: `preview-${Date.now()}` };
        }
}


    // --- 2. 試合後記事の生成ロジック ---

    // --- 準備フェーズ ---
    const winnerScore = Math.max(parseInt(dbMatch.score1) || 0, parseInt(dbMatch.score2) || 0);
    const loserScore = Math.min(parseInt(dbMatch.score1) || 0, parseInt(dbMatch.score2) || 0);
    const winnerRankDesc = getRankDescription(calculateRank(winnerName, tournamentState));
    const loserRankDesc = getRankDescription(calculateRank(loserName, tournamentState));
    const winnerRecord = tournamentState.teamRecords[winnerName];
    const loserRecord = tournamentState.teamRecords[loserName];
    const winnerDynamicInfo = generateDynamicTeamInfo(winnerName, winnerData, winnerRecord);
    const loserDynamicInfo = generateDynamicTeamInfo(loserName, loserData, loserRecord);
　　
    const winnerCoach = winnerData.coach;
    const loserCoach = loserData.coach;
    const battingFirstTeam = dbMatch.team1;
    const battingSecondTeam = dbMatch.team2;
    const winnerPrevRankStr = winnerRecord?.previousRank ? ` (前大会: ${getRankString(winnerRecord.previousRank)})` : '';
    const loserPrevRankStr = loserRecord?.previousRank ? ` (前大会: ${getRankString(loserRecord.previousRank)})` : '';
    const winnerTitles = winnerRecord?.teamTraits?.map(tId => Object.values(TITLES).find(t => t.id === tId)?.name).join(', ') || '';
    const loserTitles = loserRecord?.teamTraits?.map(tId => Object.values(TITLES).find(t => t.id === tId)?.name).join(', ') || '';
    let currentTournamentName = tournamentNameMap[tournamentState.currentTournament] || '大会';

    let roundAchievement = '';
    let seedingImplication = '';
    let specialNarrativeContext = '';
    if (tournamentState.currentTournament === 'autumn') {
        const phase = tournamentState.autumnPhase;
        if (matchId.includes('-')) {
            const [region, bracketType, roundStr] = matchId.split('-');
            const roundNum = parseInt(roundStr?.slice(1));
            if (phase === 'regional_blocks') {
                currentTournamentName = `秋季大会 ${region}地区ブロック予選`;
                if (roundNum === 2) roundAchievement = 'ブロック優勝';
            } else if (phase === 'regional_ranking') {
                currentTournamentName = `秋季大会 ${region}地区内順位決定戦`;
                if (bracketType === 'CHAMP' && roundNum === 2) {
                    roundAchievement = dbMatch.type === 'final' ? '地区1位通過' : '地区3位通過';
                } else if (bracketType === 'REP' && roundNum === 2) {
                    roundAchievement = '第5代表（敗者復活）';
                }
            } else if (phase === 'main') {
                currentTournamentName = '秋季大会 県大会本戦';
                const roundNumMain = parseInt(matchId.split('-')[1].slice(1));
                if (roundNumMain === 1) {
                    roundAchievement = '県大会初戦突破（ベスト8進出）';
                    seedingImplication = 'この勝利で、来季の春季大会のシード権獲得を確実なものとした。';
                    const winnerRank = calculateRank(winnerName, tournamentState);
                    if (winnerData.type === '公立' && (winnerRank === 'D' || winnerRank === 'E')) {
                        specialNarrativeContext = `### 【物語のハイライト】\n県大会出場だけでも快挙だった公立校「${winnerName}」が、初戦を突破し【来春のシード権】まで獲得しました！これは二重の奇跡です。この「シンデレラ・ストーリーの最高潮」をテーマに、歴史的快挙として記事を執筆してください。`;
                    }
                } else if (roundNumMain === 2) roundAchievement = '準々決勝突破(ベスト4進出)';
                else if (roundNumMain === 3) roundAchievement = '準決勝突破(決勝進出)';
            }
        }
    } else if (matchId.includes('-R')) {
        const roundNum = parseInt(matchId.split('-')[1].slice(1));
        const finalRound = tournamentState.is16team ? 4 : 6;
        if (roundNum === finalRound) roundAchievement = (tournamentState.currentTournament === 'summer') ? '甲子園出場決定！' : '優勝！';
        else if (roundNum === finalRound - 1) roundAchievement = '準決勝突破(決勝進出)';
        else if (roundNum === finalRound - 2) roundAchievement = '準々決勝突破(ベスト4進出)';
        else if (roundNum === finalRound - 3) {
            roundAchievement = '3回戦突破(ベスト8進出)';
            if (tournamentState.currentTournament === 'spring') {
                seedingImplication = 'この勝利で、夏の選手権大会のシード権獲得を確実なものとした。';
            }
        } else if (roundNum === 2) roundAchievement = '2回戦突破';
        else if (roundNum === 1) roundAchievement = '初戦突破';
    }
    
    

    // --- 詳細データがある場合 (Aルート) ---
    

    // --- 詳細データがある場合 (Aルート) ---
    if (dbMatch.details) {
        // --- 準備フェーズ ---
        const { highlights, keyPlayerNames } = createHighlightsText(dbMatch, winnerName);
        const factListText = highlights.map(fact => `- ${fact.inning || ''}回 ${fact.team || ''} ${fact.player || ''}: ${fact.description}`).join('\n');
        
        const winnerKey = dbMatch.team1 === winnerName ? 'team1' : 'team2';
        const winnerPlayersInGame = new Set(
            (dbMatch.details.batting?.[winnerKey] || []).map(p => p.name)
            .concat((dbMatch.details.pitching?.[winnerKey] || []).map(p => p.name))
        );
        const winnerKeyPlayers = keyPlayerNames.filter(name => winnerPlayersInGame.has(name));
        const loserKeyPlayers = keyPlayerNames.filter(name => !winnerPlayersInGame.has(name));

        const formatPlayerList = (playerNames, teamName, detailedTeamData) => {
            if (playerNames.length === 0) return '特になし';
            return playerNames.map(playerName => {
                const detailedInfo = detailedTeamData?.players.find(p => p.name === playerName);
                return detailedInfo ? `- **${detailedInfo.name} (${detailedInfo.year}年・${detailedInfo.position})**: ${detailedInfo.desc}` : `- **${playerName}**`;
            }).join('\n');
        };
        const winnerPlayersPrompt = formatPlayerList(winnerKeyPlayers, winnerName, winnerDetailedData);
        const loserPlayersPrompt = formatPlayerList(loserKeyPlayers, loserName, loserDetailedData);
        
        // ★★★ ここが重要：関数内部での分析は不要になり、渡された情報をそのまま使う ★★★
        const lineupChangesText = `- ${winnerName}: ${winnerLineupChanges}\n- ${loserName}: ${loserLineupChanges}`;
        
        const winnerDynamicInfo = generateDynamicTeamInfo(winnerName, winnerData, tournamentState.teamRecords[winnerName]);
        const loserDynamicInfo = generateDynamicTeamInfo(loserName, loserData, tournamentState.teamRecords[loserName]);
        const winnerCoach = winnerData.coach;
        const loserCoach = loserData.coach;

        // 1. 次の対戦相手に関するテキストを、3つのパターンに応じて準備する
        let nextOpponentText = '次の対戦相手は未定。'; // デフォルト
        if (nextOpponent) {
            // パターン1: 対戦相手が決まっている場合
            if (nextOpponent.opponentName && nextOpponent.opponentName !== '（未定）') {
                nextOpponentText = `次の${nextOpponent.roundName}では、${nextOpponent.opponentName}(${nextOpponent.opponentRank}ランク)と対戦する。`;
            } 
            // パターン2: 対戦相手は未定だが、どの試合の勝者と当たるか分かっている場合
            else if (nextOpponent.decidingMatch) {
                const dm = nextOpponent.decidingMatch;
                nextOpponentText = `次の${nextOpponent.roundName}では、${dm.team1}(${dm.rank1}ランク)と${dm.team2}(${dm.rank2}ランク)の勝者と対戦する。`;
            }
            // パターン3: それ以外の未定の場合 (この場合はデフォルトのまま)
        }
        // ★★★ 修正箇所はここまで ★★★

        prompt = `あなたは、日本の高校野球を深く愛する、情熱的なスポーツ記者です。
あなたの唯一の仕事は、提供されたデータに基づいて最高の記事を生成することです。
---
### **参考情報：高校野球における背番号の意味**
- **[#1]**: チームの絶対的エース投手。その投球がチームの運命を左右する。
- **[#2-9]**: 基本的にレギュラーの野手陣。一桁番号はチームの中心選手である証。
- **[#10], [#11]**: エースに次ぐ控え投手。
- **[#12]以降**: ベンチ入りした控え選手。時に監督の秘蔵っ子や、期待の1・2年生が含まれるサプライズ枠。
---
---
### **【最重要】この記事の唯一の事実情報源**
${factListText}
---
### **参考情報：補足**
- **前試合からのスタメン変更**:
${lineupChangesText}
- **ユーザーによる試合の決め手**: ${dbMatch.summary || 'なし'}
---
### **参考情報：チームと選手のプロフィール**
- **${winnerName}**: ${winnerDynamicInfo}
- **今大会の軌跡**: ${winnerJourney}
  - **監督**: ${winnerCoach ? `${winnerCoach.name} (${winnerCoach.style})` : '情報なし'}
  - **主な選手プロフィール**:\n${winnerPlayersPrompt}
- **${loserName}**: ${loserDynamicInfo}
  - **今大会の軌跡**: ${loserJourney}
  - **監督**: ${loserCoach ? `${loserCoach.name} (${loserCoach.style})` : '情報なし'}
  - **主な選手プロフィール**:\n${loserPlayersPrompt}
---
### **執筆指示**
1.  「事実リスト」を厳密に基に、試合の物語を再構築してください。
2.  **【監督の采配】**: 「スタメン変更」があった場合、その采配が試合にどう影響したかに触れること。
3.  **【物語の連続性】**: 「今大会の軌跡」情報を参考に、これまでの戦いと繋がりのある物語を描写すること。
4.  試合後の両チーム監督のコメントを、試合内容やチームの背景を反映させて生成すること。
5.  **【次戦への展望】**: 記事の最後に、次の対戦相手（${nextOpponentText}）に簡潔に触れ、今後の戦いへの展望を記述して締めくくること。
6.  **【背番号の意味を反映】**: 記事中で選手に言及する際、その選手の背番号が持つ意味を考慮し、物語に深みを与えてください。
---
### 編集長からの追加指示
${(userFeedback && userFeedback.include) ? `- **【最重要指示】** ${userFeedback.include}\n` : ''}
${(userFeedback && userFeedback.exclude) ? `- **【厳禁事項】** ${userFeedback.exclude}\n` : '特になし'}
---
### 出力形式
【最重要】必ず以下のJSON形式"のみ"で出力すること。
{"title": "（ここに記事のタイトル）", "body": "（ここに記事の本文）"}`;

    } 
    // --- 詳細データがない場合 (Bルート) ---
    else {
        // (こちらのルートは元々シンプルなので、大きな変更はありません)
        const winnerRankDesc = getRankDescription(calculateRank(winnerName, tournamentState));
        const loserRankDesc = getRankDescription(calculateRank(loserName, tournamentState));
        const winnerScore = Math.max(parseInt(dbMatch.score1) || 0, parseInt(dbMatch.score2) || 0);
        const loserScore = Math.min(parseInt(dbMatch.score1) || 0, parseInt(dbMatch.score2) || 0);
        prompt = `あなたは、高校野球専門のAI記者です。
以下の試合結果に基づき、簡潔で分かりやすいニュース記事を作成してください。
### 試合情報
- **勝利チーム**: ${winnerName} (${winnerRankDesc})
- **敗北チーム**: ${loserName} (${loserRankDesc})
- **スコア**: ${winnerScore} - ${loserScore}
- **ユーザーによる試合の決め手**: ${dbMatch.summary || 'なし'}
### 執筆指示
- もし「ユーザーによる試合の決め手」に記述があれば、それを中心に記事を構成してください。
- 試合結果を客観的に伝えてください。
- 記事のタイトルと本文をJSON形式で出力してください。`;
    }

    // --- AIへのリクエスト ---
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const article = parseJsonFromText(result.candidates[0].content.parts[0].text);
            if (article) {
                const isNewspaperWorthy = (dbMatch.details && (tournamentState.currentTournament !== 'autumn' || tournamentState.autumnPhase === 'main'));
                const newspaperHtml = isNewspaperWorthy ? createNewspaperHtml(article, { winnerName, loserName, dbMatch, matchId }) : null;
                return { ...article, isNewspaper: isNewspaperWorthy, timestamp: Date.now(), newspaperHtml };
            }
        }
        throw new Error("AIからの応答が予期した形式ではありません。");
    } catch (error) {
        console.error("AI記事の生成に失敗しました:", error);
        return { 
            title: "記事生成エラー", body: "AI記者との通信に失敗しました。", 
            timestamp: Date.now(), error: true, errorId: matchId,
            context: matchContext // ★再生成のためにcontext全体を保存
        };
    }
}

/**
 * AIに掲示板のコメントを生成させるメイン関数（★context共有方式に統一した最終版）
 * @param {object} matchContext - 試合の全コンテキストデータ
 * @returns {Promise<Array|null>} 生成されたコメントオブジェクトの配列
 */
async function generateBbsComments(matchContext) {
    // --- 1. 受け取った「取材ファイル(matchContext)」から必要な情報を取り出す ---
    const { 
        winnerName, loserName, dbMatch, matchId, 
        winnerData, loserData
    } = matchContext;
    
    // --- 2. AIへの指示を作成するために必要な情報を準備する ---
    const winnerScore = Math.max(parseInt(dbMatch.score1) || 0, parseInt(dbMatch.score2) || 0);
    const loserScore = Math.min(parseInt(dbMatch.score1) || 0, parseInt(dbMatch.score2) || 0);
    const winnerRankDesc = getRankDescription(calculateRank(winnerName, tournamentState));
    const loserRankDesc = getRankDescription(calculateRank(loserName, tournamentState));
    const winnerDynamicInfo = generateDynamicTeamInfo(winnerName, winnerData, tournamentState.teamRecords[winnerName]);
    const loserDynamicInfo = generateDynamicTeamInfo(loserName, loserData, tournamentState.teamRecords[loserName]);
    let specialNarrativeContext = '';
    
    if (tournamentState.currentTournament === 'autumn' && tournamentState.autumnPhase === 'main' && matchId.includes('-R1-')) {
        const winnerRank = calculateRank(winnerName, tournamentState);
        if (winnerData.type === '公立' && (winnerRank === 'D' || winnerRank === 'E')) {
            specialNarrativeContext = `### 【掲示板の話題】\n衝撃！無名の公立「${winnerName}」が県大会初戦を勝ち、【来春のシード権獲得】だ！この快進撃に驚きと嫉妬のコメントを生成せよ。`;
        }
    }

    let prompt = '';

    // --- 3. 記事の方向性を決定し、AIへの指示書(プロンプト)を作成する ---
    if (dbMatch.details) {
        // 詳細データがある場合 (Aルート)
        const { highlights } = createHighlightsText(dbMatch, winnerName);
        const highlightsText = highlights.map(fact => `- ${fact.inning || ''}回 ${fact.team || ''} ${fact.player || ''}: ${fact.description}`).join('\n');
        
        prompt = `あなたは、匿名掲示板に集う、様々な立場の高校野球ファンです。
以下の試合結果と詳細なハイライトに基づき、各キャラクターになりきって、辛辣でリアルな短いコメントを5つ生成してください。
### 試合情報
- 勝利チーム: ${winnerName} (${winnerRankDesc})
- 敗北チーム: ${loserName} (${loserRankDesc})
- スコア: ${winnerScore} - ${loserScore}
- ユーザーが語る試合の決め手: ${dbMatch.summary || '特になし'}
### 試合の主なハイライト
${highlightsText}
### チームの背景
- **${winnerName}**: ${winnerDynamicInfo}
- **${loserName}**: ${loserDynamicInfo}
${specialNarrativeContext}
### あなたがなりきるべきキャラクターと指示
- **熱狂的な勝者チームのOB**: 「試合のハイライト」で活躍した自チームの選手を熱烈に称賛してください。
- **上から目線の野球解説者**: 「試合のハイライト」のプレーを玄人っぽく分析してください。
- **アンチ**: 「試合のハイライト」で活躍した相手選手を「まぐれだ」と貶してください。
- **ライバル校のファン**: 「試合のハイライト」の選手を自チームの選手と比較してください。
- **単なる野球好き**: 「試合のハイライト」で最も印象的だったプレーの感想を述べてください。
### 出力形式
【最重要】必ず以下のJSON配列形式"のみ"で出力してください。
[ {"personality": "（キャラクター名）", "comment": "（生成したコメント）"} ]`;
    } else {
        // 詳細データがない場合 (Bルート)
        prompt = `あなたは、匿名掲示板に集う、様々な立場の高校野球ファンです。
以下の試合結果について、それぞれのキャラクターになりきって、辛辣でリアルな短いコメントを5つ生成してください。
### 試合情報
- 勝利チーム: ${winnerName} (${winnerRankDesc})
- 敗北チーム: ${loserName} (${loserRankDesc})
- スコア: ${winnerScore} - ${loserScore}
- ユーザーが語る試合の決め手: ${dbMatch.summary || '特になし'}
### チームの背景
- **${winnerName}**: ${winnerDynamicInfo}
- **${loserName}**: ${loserDynamicInfo}
${specialNarrativeContext}
### あなたがなりきるべきキャラクターと指示
- **熱狂的な勝者チームのOB**: 勝利を喜び、チームの伝統や背景に触れてコメントしてください。
- **上から目線の野球解説者**: 順当な結果か、意外な結果かを分析してください。
- **アンチ**: 負けたチームや、スコアが僅差だったチームを批判してください。
- **ライバル校のファン**: 試合結果を見て、自チームとの力関係を測るようなコメントをしてください。
- **単なる野球好き**: スコアを見て、接戦だったか、一方的だったかなどの感想を述べてください。
### 出力形式
【最重要】必ず以下のJSON配列形式"のみ"で出力してください。
[ {"personality": "（キャラクター名）", "comment": "（生成したコメント）"} ]`;
    }

    // --- 4. AIへリクエストを送信し、結果を整形して返す ---
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const rawText = result.candidates[0].content.parts[0].text;
            const commentsJson = parseJsonFromText(rawText);
            if (Array.isArray(commentsJson)) {
                return commentsJson.map(c => ({
                    id: crypto.randomUUID(),
                    personality: c.personality,
                    text: c.comment,
                    timestamp: Date.now(),
                    replies: []
                }));
            }
        }
        throw new Error("AIからの応答が、正しい配列形式ではありません。");
    } catch (error) {
        console.error("AI掲示板コメントの生成に失敗しました:", error);
        return [{
            id: `error-${matchId}-bbs`,
            error: true,
            title: `掲示板コメント生成エラー`,
            context: matchContext // ★エラー時に再生成できるよう、context全体を保存
        }];
    }
}
async function generateDocumentaryArticle(phase, type, teamName, matchData = null, userFeedback = null) {
    const teamMasterData = TEAM_DATA[teamName];
    let prompt = `あなたは、情熱的で人間ドラマを描くのが得意なドキュメンタリー番組の記者です。あなたは今、高校野球チーム「${teamName}」に密着取材しています。`;
    let title = "";

    let charactersPrompt = `### 主な登場人物\n- 監督: ${teamMasterData.coach.name} (${teamMasterData.coach.style})\n`;
    if (DETAILED_TEAM_DATA[teamName]) {
        const detailedData = DETAILED_TEAM_DATA[teamName];
        const keyPlayers = detailedData.players.map(p => `- ${p.name}(${p.year}年, ${p.position}): ${p.desc}`).join('\n');
        charactersPrompt += `### 注目選手\n${keyPlayers}\n`;
    }
    
    let feedbackPrompt = '';
    if (userFeedback) {
        if (userFeedback.include && userFeedback.include.trim() !== '') {
            feedbackPrompt += `\n- **【最重要指示】** 以下の要素を必ず記事の中心に据えて、最もドラマチックに描写してください：\n${userFeedback.include}\n`;
        }
        if (userFeedback.exclude && userFeedback.exclude.trim() !== '') {
            feedbackPrompt += `\n- **【厳禁事項】** 以下の要素や表現は、絶対に記事に含めないでください：\n${userFeedback.exclude}\n`;
        }
    }
    const finalFeedbackPrompt = `\n### ディレクターからの追加指示\n${feedbackPrompt || '特になし'}`;

    // ==================================================================
    // --- 1. 古豪復活チーム (powerhouse_revival) ---
    // ==================================================================
    if (type === 'powerhouse_revival') {
        switch (phase) {
            case 'intro':
                title = `『${teamName}、復活への序曲』`;
                let reactionPrompt = '';
                if (matchData && matchData.opponent) {
                    const ourRank = calculateRank(teamName, tournamentState);
                    const opponentRank = matchData.opponentRank;
                    const rankValues = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };
                    const rankDiff = rankValues[opponentRank] - rankValues[ourRank];

                    if (rankDiff >= 1) { // 格上
                        reactionPrompt = `
5.  **【試練の初戦】**
    初戦の相手が格上の「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。選手たちが「不足はない相手」「復活をアピールするには最高の相手だ」と闘志を燃やす。
6.  **【監督の『建前』と『本音』】**
    監督は**選手たちの前で**、「挑戦者として、失うものは何もない。全力でぶつかるぞ」という趣旨で語る。
    しかし記者の前では**二人きりで**、「本当の山場は**${matchData.toughestRival}**戦でしょう。彼らは昨年${matchData.toughestRivalRecord}。この初戦は、そこへ向けてチームがどれだけ成長できるかの試金石ですね」という趣旨で、冷静に先を見据える。`;
                    } else { // 同格か格下
                        reactionPrompt = `
5.  **【油断という名の敵】**
    初戦の相手が「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。「勝てる」という安堵の空気が選手たちの間に流れる。
6.  **【監督の『建前』と『本音』】**
    その空気を察した監督が**選手たちの前で**、「油断が一番の敵だ。俺たちはまだ何も成し遂げていない」という趣旨で厳しく一喝する。
    しかし、記者の前では**二人きりで**、「正直、ホッとしました。**${matchData.toughestRival}**（彼らは昨年${matchData.toughestRivalRecord}）と当たるまでに、いくつか試合をこなして練度を上げたかったので」という趣旨で、安堵の理由が戦略的なものであることを明かす。`;
                    }
                }
                prompt += `
### 取材テーマ
かつて黄金時代を築いた古豪「${teamName}」が、失われた栄光を取り戻すべく挑む夏を追う。過去、現在、そして未来が交錯する物語の序章を描いてください。
${charactersPrompt}
### 構成案
1.  **【埃をかぶった優勝旗】**: 部室に眠る色褪せた優勝旗やトロフィーの描写から始める。過去の栄光の重圧と、現在のチームが置かれた状況（${teamMasterData.info}）を対比させる。
2.  **【OBたちの熱き眼差し】**: 練習を厳しい目で見つめるOB会長に「俺たちの時代は…」という昔語りと、現在のチームへの歯がゆさ、そして心の底にある期待を語らせる。
3.  **【重圧を背負う主将】**: 主将に「このユニフォームを着て戦うことの意味」を問う。伝統の重みと、それを力に変えようとする彼の覚悟を描写する。
4.  **【監督の信念と現実】**: 監督に「古豪復活への道筋」をインタビューする。OBからのプレッシャーの中で、彼が信じる今の選手たちの可能性と、現在の課題について語らせる。
${reactionPrompt}
7.  **【新たな歴史へ】**: 主将の「俺たちは俺たちの野球で、新しい歴史を作るだけ」という言葉で、復活をかけた夏の始まりを力強く宣言して締めくくる。
### 描写のポイント
- 時間軸の意識: 「過去の栄光」「現在の葛藤」「未来への挑戦」を意識し、物語に深みを与えること。
- 建前と本音: 監督の二面性を描くことで、キャラクターのリアリティを追求すること。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（長編の記事本文）"}`;
                break;
            case 'win':
                title = `『${teamName}、復活への第一歩』`;
                prompt += `
### 取材テーマ
古豪「${teamName}」が ${matchData.opponent} との試合に ${matchData.score} で勝利しました。「名門復活への狼煙」となるこの一勝の価値を、感動的に描写してください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」を物語の中心に据え、その場面を最もドラマチックに描写する。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れ、この勝利の価値をより高める。
3.  監督に「伝統の粘り強さが出せた」という趣旨のコメントをさせる。
4.  主将に、次戦への意気込みと共に「先輩たちが築いた歴史に、新たな1ページを刻みたい」と語らせる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
            case 'lose':
                title = `『${teamName}、夢、またも届かず』`;
                prompt += `
### 取材テーマ
古豪「${teamName}」の夏が終わりを告げた。復活を願った人々の期待と、それに応えられなかった選手たちの無念さを描いてください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」が、いかにしてチームの夢を打ち砕いたかを詳細に描写する。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れ、敗北の文脈をより深く描写する。
3.  グラウンドに泣き崩れる選手たちと、彼らにかける言葉が見つからない監督の姿。
4.  「彼らの挑戦は終わった。しかし、〇〇（校名）の野球部の灯が消えることはない」と、未来への希望で締めくくる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
        }
    } 
    // ==================================================================
    // --- 2. 絶対的エースチーム (one_man_team) ---
    // ==================================================================
    else if (type === 'one_man_team') {
        switch (phase) {
            case 'intro':
                title = `『${teamName}のエースと、8人の仲間たち』`;
                let reactionPrompt = '';
                if (matchData && matchData.opponent) {
                    const ourRank = calculateRank(teamName, tournamentState);
                    const opponentRank = matchData.opponentRank;
                    const rankValues = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };
                    const rankDiff = rankValues[opponentRank] - rankValues[ourRank];

                    if (rankDiff >= 2) { // 絶望的な格上
                        reactionPrompt = `
5.  **【試される『個』の力】**
    初戦の相手が格上の強豪「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。野手たちが動揺する中、エースだけが「相手が誰であろうと、俺がゼロに抑えるだけです」という趣旨のコメントで闘志を燃やす。
6.  **【監督の『建前』と『本音』】**
    監督は**選手たちの前で**、「最高の相手だ。我々には〇〇（エース名）がいる。彼を信じろ」という趣旨のコメントで、エースへの絶対的な信頼を口にする。
    しかし記者の前では**二人きりで**、「正直、最悪のクジです。彼（エース）の負担を考えれば、勝ち進んだ先の**${matchData.toughestRival}**（昨年${matchData.toughestRivalRecord}）戦まで、他の選手に経験を積ませたかった」という趣旨のコメントで、チーム全体の成長を願う本音を漏らす。`;
                    } else { // 同格か格下
                        reactionPrompt = `
5.  **【エース温存か、否か】**
    初戦の相手が「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。選手たちの間に「この相手なら、エース抜きでも勝てるのでは？」という慢心が生まれる。
6.  **【監督の『賭け』】**
    監督が**選手たちの前で**、「初戦、〇〇（エース名）は投げない。お前たちで勝ち上がってこい」という趣旨の、非情とも思える決断を下す。
    記者の前では**二人きりで**、「これは賭けです。でも、**${matchData.toughestRival}**（昨年${matchData.toughestRivalRecord}）と戦うことを見据えれば、ここで他の選手が覚醒しなければ未来はない」という趣旨のコメントで、エースの将来とチームの未来を想う本音を語らせる。`;
                    }
                }
                prompt += `
### 取材テーマ
プロ注目の絶対的エースを擁する「${teamName}」。天才の苦悩と、彼を支える「その他大勢」と呼ばれた仲間たちのプライドを描く。
${charactersPrompt}
### 構成案
1.  **【殺到する報道陣】**: 練習グラウンドに集まる、エースだけを狙う無数のカメラの描写から始める。
2.  **【エースの孤独なマウンド】**: エースにインタビュー。「チームを勝たせるのが自分の仕事」と語る彼の言葉の裏にある、重いプレッシャーを描写する。
3.  **【名もなき脇役たちの意地】**: メディアからは注目されない他の野手たちに焦点を当てる。「俺たちは、あいつの引き立て役じゃない」という、彼らの静かなプライドと葛藤を引き出す。
4.  **【監督の信念】**: 監督に「彼らはワンマンチームですか？」と問う。「世間はそう言うだろう。だが、本当の主役が誰なのかを私だけは知っている」という趣旨の意味深な言葉を語らせる。
${reactionPrompt}
7.  **【一つのチームとして】**: 野手の一人が「俺たちが、あいつを甲子園のマウンドに連れて行く」と力強く宣言し、物語を締めくくる。
### 必ず含めるべき要素
- **チームが抱える状況を描写すること: ${teamMasterData.info}**
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（長編の記事本文）"}`;
                break;
            case 'win':
                title = `エース快投！しかし、勝利の影に${teamName}の結束あり`;
                prompt += `
### 取材テーマ
「${teamName}」が勝利。メディアはエースの快投ばかりを報じるだろう。しかし、その裏にあった仲間たちのファインプレーやチームの結束こそが真の勝因だったことを、あなたの視点で深く描写してください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」が、いかにチームの結束力を象徴するプレーだったかを物語の中心に据える。
2.  エースの投球内容を簡潔に紹介しつつ、「しかし、この日の主役は彼だけではなかった」と続ける。
3.  そのプレーをした選手に「エースを助けるのが俺たちの仕事ですから」と、誇らしげに語らせる。
4.  エースに「今日の勝利は、俺一人の力じゃない。みんなが守ってくれたおかげです」と、初めて仲間に感謝の言葉を述べさせる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
            case 'lose':
                title = `英雄、あまりに早すぎる敗退。${teamName}の夏、終わる`;
                prompt += `
### 取材テーマ
絶対的エースを擁しながら、「${teamName}」は敗れた。天才と仲間たちの、残酷で、しかし美しい夏の終わりを描いてください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」が、いかにして絶対的エースを打ち崩したのか、その一瞬を詳細に描写する。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れることで、敗北の衝撃を際立たせる。
3.  マウンドで呆然とするエースと、彼に駆け寄り「お前のせいじゃない」と声をかける仲間たちの姿を描く。
4.  「彼らはワンマンチームではなかった。勝つ時も、負ける時も、彼らは一つのチームだった」と締めくくる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
        }
    } 
    // ==================================================================
    // --- 3. 強豪校 (powerhouse) ---
    // ==================================================================
    else if (type === 'powerhouse') {
        switch (phase) {
            case 'intro':
                title = `『${teamName}、王者の告白』序章`;
                let reactionPrompt = '';
                if (matchData && matchData.opponent) {
                    const ourRank = calculateRank(teamName, tournamentState);
                    const opponentRank = matchData.opponentRank;
                    const rankValues = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };
                    const rankDiff = rankValues[opponentRank] - rankValues[ourRank];

                    if (rankDiff >= 0) { // 同格か格上
                        reactionPrompt = `
5.  **【試される王国】**
    初戦の相手がいきなり実力校「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。選手たちの間に走る緊張感を「歓迎すべき試練」として描写する。
6.  **【監督の『建前』と『本音』】**
    監督は**選手たちの前で**、「初戦から最高の相手だ。挑戦者を受ける覚悟はできている」という趣旨で、チームのプライドを煽る。
    しかし記者の前では**二人きりで**、「厳しい戦いになる。だが、このブロックの本命は我々と**${matchData.toughestRival}**。彼らは昨年${matchData.toughestRivalRecord}。倒すためには、どこかで通らなければいけない道だ」という趣旨で、厳しい本音を語らせる。`;
                    } else { // 格下
                        reactionPrompt = `
5.  **【王者の静寂】**
    初戦の相手が「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。選手たちは表情一つ変えず、淡々と次の練習の準備を始める。
6.  **【監督の『建前』と『本音』】**
    監督が**選手たちの前で**は「油断するな」という趣旨で引き締めつつ、記者の前では**二人きりで**、「初戦は問題ない。本当の勝負は**${matchData.toughestRival}**戦。彼らは昨年${matchData.toughestRivalRecord}の実力校だ。そこが事実上の決勝戦になるだろう」という趣旨で、先を見据えた分析を語らせる。`;
                    }
                }
                prompt += `
### 取材テーマ
絶対的王者「${teamName}」の栄光の裏に隠された苦悩と、常人には理解しがたいプレッシャーを描く。
${charactersPrompt}
### 構成案
1.  **【静寂のトロフィー室】**: 無数に並ぶ優勝トロフィーが放つ輝きと、「勝って当然」という重圧を描写する。
2.  **【Bグラウンドの陽炎】**: ベンチ入りできなかった3年生が、最後の夏にも関わらず、黙々と後輩へのサポートを務める。彼の「チームへの愛」と「諦め」の独白を引き出す。
3.  **【監督の非情な勝負論】**: 監督にインタビュー。「勝つためには、時に非情にならなければならない。それが王者であり続けるということだ」という彼の哲学を語らせる。
4.  **【主将の孤独な背中】**: スター選手揃いのチームを一つにまとめることの難しさと、「負けることが許されない」という王者ならではの孤独な覚悟を主将に語らせる。
${reactionPrompt}
7.  **【王者、出陣】**: 主将が「俺たちの目標は、県大会優勝じゃない。その先にある」と、全国の頂点だけを見据えていることを示唆して締めくくる。
### 必ず含めるべき要素
- **チームが抱える状況を描写すること: ${teamMasterData.info}**
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（長編の記事本文）"}`;
                break;
            case 'win':
                title = `『${teamName}、王者の告白』第${matchData.round}章`;
                prompt += `
### 取材テーマ
「${teamName}」が勝利。しかし彼らにとってこの勝利は歓喜ではなく、「次へ進むための義務」でしかない。その独特の空気感をリアルに描写してください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」を引用し、それが王者としての力の証明であったことを示す。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れ、勝利が順当であったことを描写する。
3.  試合後、安堵の表情を浮かべるも、決して喜びを爆発させない選手たちの姿。
4.  監督に「今日のプレーで満足せず、次を見据えている」という趣旨の、冷静なコメントをさせる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
            case 'lose':
                title = `『${teamName}、王者の告白』最終章`;
                prompt += `
### 取材テーマ
絶対的王者「${teamName}」の夏が終わった。王国の崩壊の瞬間と、選手たちの初めて見せる涙、そして重圧からの解放を感傷的に記録してください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」が、いかにして絶対王者の歯車を狂わせたのか、その瞬間を克明に描写する。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れ、この敗戦が歴史的な番狂わせであることを強調する。
3.  試合終了のサイレンが鳴り響く、球場の信じられないような静寂を描写する。
4.  これまで常に気丈に振る舞ってきた主将が、初めてグラウンドに泣き崩れる姿に焦点を当てる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
        }
    } 
    // ==================================================================
    // --- 4. 逆境チーム (underdog) ---
    // ==================================================================
    else { 
        switch (phase) {
            case 'intro':
                title = `『${teamName}、魂の記録』序章`;
                let reactionPrompt = '';
                if (matchData && matchData.opponent) {
                    const ourRank = calculateRank(teamName, tournamentState);
                    const opponentRank = matchData.opponentRank;
                    const rankValues = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };
                    const rankDiff = rankValues[opponentRank] - rankValues[ourRank];

                    if (rankDiff >= 2) { // 絶望的な格上
                        reactionPrompt = `
3.  **【残酷な現実、そして監督の『建前』】**
    初戦の相手が格上の強豪「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。絶望と沈黙に包まれる選手たち。
    その重い空気の中、監督が**選手たちの前で**「これは試練だ。だが、歴史を創るチャンスでもある」という趣旨の力強い言葉でチームを奮い立たせる。
4.  **【監督室の『本音』】**
    記者が二人きりで監督に心境を聞くと、「いや、正直しんどいですよ…笑っちゃいましたもん、まさか〇〇（相手校名）と当たるなんて…」という趣旨の、人間味あふれる弱音や本音を漏らす。`;
                    } else if (rankDiff >= 1) { // 少し格上
                        reactionPrompt = `
3.  **【挑戦者たち】**
    初戦の相手が、格上の「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。選手たちが「不足はない相手」「一泡吹かせてやる」と闘志を燃やす。
4.  **【監督の戦略】**
    監督は**選手たちの前で**「良い顔つきになったな」と彼らの士気を高めつつ、記者の前では**二人きりで**、「正直、勝率は3割もないでしょう。でも、高校野球は何が起こるか分からない」という趣旨で、冷静な分析と本音を語る。`;
                    } else { // 同格か格下
                        reactionPrompt = `
3.  **【運命の初戦】**
    初戦の相手が実力の近い「${matchData.opponent}」(昨年度: ${matchData.opponentRecord})に決定。「勝てる！」と少し浮足立つ選手たち。
4.  **【監督の『建前』と『本音』】**
    監督が**選手たちの前で**「油断が一番の敵だ」と厳しく一喝する一方、記者の前では**二人きりで**、「最高のクジを引きました。ここを勝てば、間違いなくチームは波に乗れる」という趣旨で、安堵とプレッシャーが入り混じった本音を語る。`;
                    }
                }
                prompt += `
### 取材テーマ
「${teamName}」が抱える困難な状況と、それでも夢を諦めない彼らの姿を描く。
${charactersPrompt}
### 構成案
1.  **【チームの現在地】**: 記者がチームの元を訪れる場面から始める。監督や選手にインタビューし、チームが抱える具体的なハンデ（例：${teamMasterData.info}）と、それに対する彼らの想いを明らかにする。
2.  **【地域との絆】**: チームを支える地元の人々（例：商店街の店主、OBなど）にも話を聞き、地域にとってこのチームがどのような存在であるかを描写する。
${reactionPrompt}
5.  **【決意表明】**: 最後に、主将が大会へ向かう決意を語り、締めくくる。
### 必ず含めるべき要素
- **チームが抱える状況を描写すること: ${teamMasterData.info}**
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（長編の記事本文）"}`;
                break;
            case 'win':
                title = `『${teamName}、魂の記録』第${matchData.round}章`;
                prompt += `
### 取材テーマ
「${teamName}」が、奇跡的な勝利を収めた。この一勝が彼らにとってどれほど大きな意味を持つのか、感動的に描写してください。
### 対戦相手「${matchData.opponent}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」を、この試合で起きた奇跡の象徴として、最も感動的に描写する。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れ、この勝利がどれほどの金星であったかを伝える。
3.  勝利の瞬間、子供のように抱き合って泣く選手たちの姿を描写する。
4.  この勝利を見届けた地元の人々の、我が事のような喜びの声を加える。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
            case 'lose':
                title = `『${teamName}、魂の記録』最終章`;
                prompt += `
### 取材テーマ
「${teamName}」の夏が終わった。夢破れた彼らの姿と、それでも確かに残ったものを描くドキュメンタリー最終章。
### 対戦相手「${teamName}」の背景
${matchData.opponentInfo}
### ユーザーが語る試合の決め手
${matchData.summary || '特になし'}
### この試合の主なハイライト
${matchData.highlights}
### 構成案
1.  ユーザーが語る「試合の決め手」に触れ、あと一歩及ばなかった彼らの奮闘を称える。
2.  対戦相手がどのようなチームであったか（【対戦相手の背景】を参照）に触れ、「よくやった」「悔しい」といった感情を増幅させる。
3.  試合終了の瞬間、泣き崩れるも、やがて顔を上げ、相手にエールを送る選手たちの姿を描写する。
4.  3年生の引退と、彼らの想いが後輩たちへと受け継がれていくことを示唆して、物語を締めくくる。
${finalFeedbackPrompt}
### 出力形式: JSON {"title": "${title}", "body": "（記事本文）"}`;
                break;
        }
    }
    
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const article = parseJsonFromText(result.candidates[0].content.parts[0].text);
            if (article) return { ...article, timestamp: Date.now() };
        }
        throw new Error("AI response format error.");
    } catch (error) {
        console.error("AI documentary article generation failed:", error);
        return null;
    }
}

/**
 * AIに甲子園（または東海大会）の結果を総括する記事を生成させる
 */
async function generateKoshienSummaryArticle(teamName, resultLabel, type) {
    let context, titleInstruction;

    if (type === 'summer') {
        context = `夏の甲子園、全国の頂点を目指した${teamName}の戦いが終わりました。`;
        titleInstruction = `「${teamName}、聖地での戦いの軌跡」のような、夏の終わりを感じさせる感動的なタイトルにしてください。`;
    } else if (type === 'spring') {
        context = `選抜高校野球大会に出場した${teamName}の最終結果が確定しました。`;
        titleInstruction = `「${teamName}、春の聖地に爪痕」のように、来たる夏への期待を感じさせるタイトルにしてください。`;
    } else { // tokai
        context = `秋季東海大会で、静岡県代表の${teamName}が見事な戦いを見せました。`;
        titleInstruction = `「${teamName}、センバツ当確！」のように、速報らしく、喜びが伝わるタイトルにしてください。`;
    }

    const prompt = `あなたは、情熱的な高校野球専門のAI記者です。
以下の情報に基づき、読者の心を打つような総括記事を生成してください。

### 大会結果
- チーム: ${teamName}
- 最終成績: ${resultLabel}
- 文脈: ${context}

### 執筆指示
- ${titleInstruction}
- チームのこれまでの努力や、県大会での戦いぶりを称え、今回の結果が持つ意味をドラマチックに描写してください。
- 最後に、選手たちへの賛辞や、今後のチームへの期待を述べて締めくくってください。

### 出力形式
JSON形式で出力してください: {"title": "記事のタイトル", "body": "記事の本文"}`;

    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const article = parseJsonFromText(result.candidates[0].content.parts[0].text);
            if (article) return { ...article, timestamp: Date.now() };
        }
        throw new Error("AIからの応答が予期した形式ではありません。");
    } catch (error) {
        console.error("AI甲子園記事の生成に失敗しました:", error);
        return { title: "記事生成エラー", body: "AI記者との通信に失敗しました。", timestamp: Date.now(), error: true };
    }
}

/**
 * 生成された記事と元の「事実リスト」を比較し、内容が矛盾していないかAIに確認させる
 * @param {object} article - AI記者が生成した記事オブジェクト
 * @param {Array} facts - createHighlightsTextから生成された元の事実オブジェクトの配列
 * @returns {boolean} - 矛盾がなければtrue、あればfalseを返す
 */
/**
 * 生成された記事と元の「事実リスト」を比較し、内容が矛盾していないかAIに確認させる
 */
async function factCheckArticle(article, facts) {
    // ▼▼▼ この安全装置がクラッシュを防ぎます ▼▼▼
    if (!article || !article.body) {
        console.error("事実確認エラー: 記事データ、または記事の本文がありません。");
        return false; // 不完全な記事は「矛盾あり」とみなして処理を中断
    }
    // ▲▲▲

    const factListText = facts.map(fact => `- ${fact.inning || ''}回 ${fact.team || ''} ${fact.player || ''}: ${fact.description}`).join('\n');

    const prompt = `あなたは厳格なファクトチェッカーです。以下の【事実リスト】と【記事】を比較し、記事に事実と異なる記述がないか判定してください。
### 事実リスト
${factListText}
### 記事
**タイトル:** ${article.title}
**本文:** ${article.body.replace(/\\n/g, '\n')}
### 指示
記事の内容が、事実リストと**著しく矛盾している場合のみ「いいえ」**と答えてください。表現の僅かな違いは許容します。あなたの答えは「はい」か「いいえ」の二文字だけでお願いします。`;

    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const aiResponse = result.candidates[0].content.parts[0].text.trim();
            console.log("事実確認AIの応答:", aiResponse);
            return aiResponse.includes('はい');
        }
        return false;
    } catch (error) {
        console.error("事実確認AIの呼び出しに失敗しました:", error);
        return false;
    }
}

/**
 * 試合の詳細データから「事実オブジェクトの配列」と活躍選手リストを返す（★打順の巡りを完全再現する最終版）
 * @param {object} dbMatch - 試合のデータオブジェクト
 * @param {string} winnerName - 勝者名
 * @returns {{highlights: Array, keyPlayerNames: Array}}
 */
function createHighlightsText(dbMatch, winnerName) {
    if (!dbMatch.details) {
        return { highlights: [], keyPlayerNames: [] };
    }

    // --- 内部ヘルパー関数：打席結果を日本語に翻訳 ---
    const translateResult = (res, playerInfo, eventType) => {
        if (!res) return null;
        let description = `${playerInfo}が`;
        const rbiMatch = res.match(/(\d+)点/);
        const rbiText = rbiMatch ? (parseInt(rbiMatch[1]) > 1 ? `${rbiMatch[1]}点` : '') : '';
        if (res.includes('本塁打')) description = `${playerInfo}が${eventType}となる${rbiText}本塁打を放った`;
        else if (res.includes('三塁打')) description = `${playerInfo}が${eventType}となる${rbiText}三塁打を放った`;
        else if (res.includes('二塁打')) description = `${playerInfo}が${eventType}となる${rbiText}二塁打を放った`;
        else if (res.includes('安')) description = `${playerInfo}が${eventType}となる${rbiText}ヒットを放った`;
        else if (res.includes('犠飛')) description = `${playerInfo}が犠牲フライで${eventType}となる${rbiText || '1'}点を挙げた`;
        else if (res.includes('犠失')) description = `${playerInfo}が犠牲バントエラーで出塁した`;
        else if (res.includes('ゴロ') && res.includes('点')) description = `${playerInfo}の内野ゴロの間に${eventType}となる${rbiText || '1'}点を挙げた`;
        else if ((res.includes('エラー') || res.includes('失')) && res.includes('点')) description = `相手エラーの間に${eventType}となる${rbiText || '1'}点を記録した`;
        else if (res.includes('犠打')) description = `${playerInfo}が送りバントを決めた`;
        else if (res.includes('四球')) description = `${playerInfo}が四球を選んだ`;
        else if (res.includes('死球')) description = `${playerInfo}が死球で出塁した`;
        else if (res.includes('エラー')) description = `${playerInfo}がエラーで出塁した`;
        else if (res.includes('野選')) description = `${playerInfo}が野選で出塁した`;
        else if (res.includes('三振')) description = `${playerInfo}が三振に倒れた`;
        else if (res.includes('併殺')) description = `${playerInfo}が併殺打に倒れた`;
        else if (res.includes('ゴロ')) description = `${playerInfo}が内野ゴロに倒れた`;
        else if (res.includes('飛')) description = `${playerInfo}が外野フライに倒れた`;
        else if (res.includes('直')) description = `${playerInfo}がライナーに倒れた`;
        else return null;
        return description.replace(/1点/g, '');
    };
    
    const highlights = [];
    const keyPlayerNames = new Set();
    const winningTeamKey = dbMatch.team1 === winnerName ? 'team1' : 'team2';
    const losingTeamKey = winningTeamKey === 'team1' ? 'team2' : 'team1';
    const numInnings = dbMatch.details.inningScore?.team1?.length || 9;

    let hasScored = false;
    let isReversed = false;
    let scores = { team1: 0, team2: 0 };
let batterIndices = { team1: 0, team2: 0 };
    
// --- 1. イニングごとのプレーを、正しい打順で解析 ---
    for (let i = 0; i < numInnings; i++) {
        for (const teamKey of ['team1', 'team2']) {
            const teamName = dbMatch[teamKey];
            const opponentTeamKey = teamKey === 'team1' ? 'team2' : 'team1';
            const allBattingData = dbMatch.details.batting?.[teamKey] || [];
            if (allBattingData.length === 0) continue;

            const sortedBattingOrder = allBattingData.sort((a,b) => parseFloat(a.order.replace('-sub','.')) - parseFloat(b.order.replace('-sub','.')));
            
            // A. この半イニングに発生した全てのプレーを一旦収集する
            let playsInHalfInning = [];
            sortedBattingOrder.forEach(player => {
                const resultString = player.results?.[i];
                if (resultString) {
                    resultString.split('、').forEach(atBatString => {
                        if(atBatString) {
                            playsInHalfInning.push({ player, atBatString });
                        }
                    });
                }
            });

            if (playsInHalfInning.length === 0) continue;

            // B.「次の打者」を基準に、プレーを時系列順に並べ替える
            const startingBatterOrder = sortedBattingOrder[batterIndices[teamKey]].order;
            playsInHalfInning.sort((a, b) => {
                const orderA = parseFloat(a.player.order.replace('-sub','.'));
                const orderB = parseFloat(b.player.order.replace('-sub','.'));
                const startOrder = parseFloat(startingBatterOrder.replace('-sub','.'));
                
                const adjustedOrderA = orderA >= startOrder ? orderA : orderA + 100;
                const adjustedOrderB = orderB >= startOrder ? orderB : orderB + 100;

                return adjustedOrderA - adjustedOrderB;
            });

            // C. 並べ替えた正しい順序で、ハイライトを生成する
            playsInHalfInning.forEach(play => {
                const { player, atBatString } = play;
                const [batterPlay, runnerPlaysString] = atBatString.split(';');
                const playerInfo = `${player.name}(${player.order.includes('sub') ? '交代' : player.order + '番'})`;
                
                if (batterPlay && batterPlay.trim() !== '') {
                    if (batterPlay.includes('点') || batterPlay.toLowerCase().includes('hr') || batterPlay.includes('本')) {
                        const prevTotalScore = scores[teamKey];
                        const rbiMatch = batterPlay.match(/(\d+)点/);
                        let addedScore = rbiMatch ? parseInt(rbiMatch[1]) : (batterPlay.includes('点') ? 1 : 0);
                        if (batterPlay.includes('本')) addedScore = Math.max(1, addedScore);
                        scores[teamKey] += addedScore;

                        let eventType = '追加点';
                        if (!hasScored) { eventType = '先制'; hasScored = true; }
                        else if (teamKey === winningTeamKey && prevTotalScore <= scores[opponentTeamKey] && scores[teamKey] > scores[opponentTeamKey] && !isReversed) { eventType = '逆転'; isReversed = true; }
                        
                        const description = translateResult(batterPlay, playerInfo, eventType);
                        if (description) {
                            highlights.push({ inning: i + 1, team: teamName, player: player.name, description });
                            keyPlayerNames.add(player.name);
                        }
                    } else {
                        const description = translateResult(batterPlay, playerInfo, '');
                        if (description) {
                            highlights.push({ inning: i + 1, team: teamName, player: player.name, description: description.replace(/がとなる/g, 'が') });
                            keyPlayerNames.add(player.name);
                        }
                    }
                }
                
                if (runnerPlaysString) {
                    runnerPlaysString.split(',').forEach(runnerPlay => {
                        if (!runnerPlay) return;
                        const runnerPlayParts = runnerPlay.trim().split(' ');
                        if (runnerPlayParts.length < 2) return;
                        const runnerName = runnerPlayParts[0];
                        const play = runnerPlayParts[1];
                        const detail = runnerPlayParts.slice(2).join(' ') || '';
                        let description = `${runnerName}が`;

                        if (play === '盗塁') description += `盗塁を成功させ${detail}！`;
                        else if (play === 'タッチアップ') description += `タッチアップから${detail}！`;
                        else if (play === '生還' || (play === '進塁' && detail.includes('生還'))) description += `好走塁でホームイン！`;
                        else if (play.includes('死') || play.includes('アウト')) description += `走塁ミスでアウトになった`;
                        else if (play === '進塁') description += `進塁し${detail}。`;
                        
                        highlights.push({ type: 'baserunning', inning: i + 1, team: teamName, player: runnerName, description: description });
                        keyPlayerNames.add(runnerName);
                    });
                }
            });

            // D. この回の最終打者を記録し、次のイニングの先頭打者を更新する
            if (playsInHalfInning.length > 0) {
                const lastBatter = playsInHalfInning[playsInHalfInning.length - 1].player;
                const lastBatterOrder = parseFloat(lastBatter.order.replace('-sub','.'));
                const lastBatterIndexInLineup = sortedBattingOrder.findIndex(p => parseFloat(p.order.replace('-sub','.')) === lastBatterOrder);
                batterIndices[teamKey] = (lastBatterIndexInLineup + 1) % sortedBattingOrder.length;
            }
        }
    }
    // --- 2. 試合全体の個別要素を分析 ---
    const loserName = dbMatch[losingTeamKey];
    const losingPitchers = dbMatch.details.pitching?.[losingTeamKey] || [];
    if (losingPitchers.length === 1) {
        const ace = losingPitchers[0];
        if (ace.result === 'L' && parseFloat(ace.innings) >= 8 && parseInt(ace.earnedRuns) <= 2) {
             highlights.push({ type: 'tough_loss', team: loserName, player: ace.name, description: `${ace.name}投手は${ace.innings}回を${ace.earnedRuns}失点と好投したが、打線の援護に恵まれなかった` });
             keyPlayerNames.add(ace.name);
        }
    }

    for (const teamKey of ['team1', 'team2']) {
        const teamName = dbMatch[teamKey];
        const teamBatting = dbMatch.details.batting?.[teamKey] || [];
        const substitutes = teamBatting.filter(p => p.sub_type);

        substitutes.forEach(subPlayer => {
            for (let i = 0; i < numInnings; i++) {
                const resultInInning = subPlayer.results[i];
                if (resultInInning) {
                    if (subPlayer.sub_type === 'PH' && (resultInInning.includes('安') || resultInInning.includes('本') || resultInInning.includes('二') || resultInInning.includes('三'))) {
                        const subDescription = getSubstitutionDescription(subPlayer);
                        highlights.push({ type: 'substitute_hit', inning: i + 1, team: teamName, player: subPlayer.name, description: `${subDescription}し、起用に応えるヒットを放った` });
                        keyPlayerNames.add(subPlayer.name);
                    }
                    if (subPlayer.sub_type === 'PITCHER') {
                         highlights.push({ type: 'pitching_change', inning: i + 1, team: teamName, player: subPlayer.name, description: `リリーフとしてマウンドに上がった` });
                         keyPlayerNames.add(subPlayer.name);
                    }
                    break; 
                }
            }
        });
    }
    
    for (const teamKey of ['team1', 'team2']) {
        const teamName = dbMatch[teamKey];
        const pitchingData = dbMatch.details.pitching?.[teamKey] || [];
        if (!pitchingData) continue;

        pitchingData.forEach((pitcher) => {
            if (!pitcher.name) return;
            const innings = parseFloat(pitcher.innings || 0);
            const runs = parseInt(pitcher.runs || 0);
            const strikeouts = parseInt(pitcher.strikeouts || 0);
            if (pitcher.result === 'W' && runs === 0 && innings >= 7) {
                highlights.push({ type: 'pitching_feat', team: teamName, player: pitcher.name, description: '圧巻の投球で完封勝利' });
                keyPlayerNames.add(pitcher.name);
            } else if (strikeouts >= 10) {
                highlights.push({ type: 'pitching_feat', team: teamName, player: pitcher.name, description: `${strikeouts}奪三振の快投` });
                keyPlayerNames.add(pitcher.name);
            }
        });
    }

    if (dbMatch.details.pitching) {
        for (const teamKey of ['team1', 'team2']) {
            const teamName = dbMatch[teamKey];
            const pitchingData = dbMatch.details.pitching[teamKey] || [];
            if (pitchingData.length > 1) {
                const pitcherNames = pitchingData.map(p => `${p.name}(${p.innings}回)`);
                highlights.push({ type: 'pitching_relay', team: teamName, description: `投手リレーは ${pitcherNames.join(' → ')} だった` });
            }
        }
    }

    // --- 3. 試合全体の物語性を分析し、総括ハイライトを生成 ---
    let summaryHighlight = null;
    const winnerScore = parseInt(dbMatch[winningTeamKey === 'team1' ? 'score1' : 'score2']);
    const loserScore = parseInt(dbMatch[losingTeamKey === 'team1' ? 'score1' : 'score2']);
    const totalRuns = winnerScore + loserScore;
    const winnerBatting = dbMatch.details.batting?.[winningTeamKey] || [];
    const loserBatting = dbMatch.details.batting?.[losingTeamKey] || [];
    const winnerPitching = dbMatch.details.pitching?.[winningTeamKey] || [];
    const countHits = (battingData) => battingData.reduce((sum, p) => sum + (p.results?.reduce((inningSum, res) => inningSum + (res && (res.includes('安') || res.includes('塁打')) ? 1 : 0), 0) || 0), 0);
    const winnerHits = countHits(winnerBatting);
    const totalHits = winnerHits + countHits(loserBatting);
    const inningScores = dbMatch.details.inningScore;
    let scoreAfter6th = { team1: 0, team2: 0 };
    for(let i = 0; i < numInnings; i++) {
        if (i < 6) {
             scoreAfter6th.team1 += parseInt(inningScores?.team1[i] || 0);
             scoreAfter6th.team2 += parseInt(inningScores?.team2[i] || 0);
        }
    }
    const winnerScoreAfter6th = scoreAfter6th[winningTeamKey];
    const loserScoreAfter6th = scoreAfter6th[losingTeamKey];
    const lastInning = numInnings - 1;
    const lastInningScore = parseInt(inningScores?.[winningTeamKey][lastInning] || 0);
    
    if (lastInning >= 8 && lastInningScore > 0 && scores[losingTeamKey] < scores[winningTeamKey]) {
        summaryHighlight = { type: 'summary', description: `劇的なサヨナラ勝ちで、${winnerName}が熱戦に終止符を打った` };
    } else if (winnerScoreAfter6th < loserScoreAfter6th && numInnings >= 7) {
        summaryHighlight = { type: 'summary', description: `${winnerName}が終盤に試合をひっくり返す、劇的な逆転勝利となった` };
    } else if (totalRuns <= 5 && totalHits <= 12) {
        summaryHighlight = { type: 'summary', description: `両チームの投手が好投し、1点を争う緊迫した投手戦となった` };
    } else if (totalRuns >= 13 && totalHits >= 20) {
        summaryHighlight = { type: 'summary', description: `両チーム合わせて${totalHits}安打${totalRuns}得点が乱れ飛ぶ、壮絶な乱打戦となった` };
    } else if (winnerScore - loserScore >= 7) {
        summaryHighlight = { type: 'summary', description: `${winnerName}が投打に圧倒し、一方的な試合展開で勝利を収めた` };
    }
    
    if (summaryHighlight) {
        highlights.unshift(summaryHighlight);
    }
    
    return { highlights: highlights, keyPlayerNames: Array.from(keyPlayerNames) };
}
/**
     * チームランク（A～E）から説明的な文字列を取得する
     */
    function getRankDescription(rank) {
        switch(rank) {
            case 'A': return '名門校';
            case 'B': return '強豪校';
            case 'C': return '中堅校';
            case 'D': return '発展途上のチーム';
            case 'E': return '挑戦者';
            default: return '実力不明';
        }
    }
// --- Team Rank Calculation ---
    function calculateRank(teamName, context) {
    if (!teamName) return ''; 

    const teamData = TEAM_DATA[teamName];
    
    // ▼▼▼ この安全装置を追加 ▼▼▼
    if (!teamData) {
        // もしTEAM_DATAにチームが見つからなければ、エラーを起こさずに
        // デフォルトのEランクを返して、この関数の処理を終了する
        return 'E'; 
    }
    // ▲▲▲ ▲▲▲

    // この行は、上記のチェックのおかげで安全に実行される
    let score = 0;
    score += teamData.deviation;

        if (teamData.best.includes('優勝')) score += 25;
        else if (teamData.best.includes('準優勝')) score += 20;
        else if (teamData.best.includes('ベスト4')) score += 15;
        else if (teamData.best.includes('ベスト8')) score += 10;
        else if (teamData.best.includes('出場')) score += 10;
        else if (teamData.best.includes('ベスト16')) score += 5;

        if (teamData.popularity) score += 5;

        if (context.teamRecords && context.teamRecords[teamName]) {
            const lastFinish = state.teamRecords[teamName].lastFinish;
            const rankMultiplier = 3.0; 
            if (lastFinish === 1) score += 30 * rankMultiplier; 
            else if (lastFinish === 2) score += 25 * rankMultiplier;
            else if (lastFinish <= 4) score += 20 * rankMultiplier;
            else if (lastFinish <= 8) score += 15 * rankMultiplier;
            else if (lastFinish <= 16) score += 5 * rankMultiplier;
            else if (lastFinish >= 64) score -= 5 * rankMultiplier;
        }
        
        if (score >= 85) return 'A';
        if (score >= 70) return 'B';
        if (score >= 55) return 'C';
        if (score >= 40) return 'D';
        return 'E';
    }
// --- Tournament Logic & Rendering ---
/**
 * チームの紹介文を動的に生成する最終進化版。
 * TEAM_DATAの固定情報に、最新の成績情報を付け加える。
 * @param {string} teamName - チーム名
 * @param {object} teamData - TEAM_DATAから取得したそのチームの基本情報
 * @param {object} teamRecord - tournamentState.teamRecordsから取得したそのチームの成績記録
 * @returns {string} - 生成された最新の紹介文
 */
function generateDynamicTeamInfo(teamName, teamData, teamRecord) {
// ▼▼▼ この安全装置が、今後のあなたを助けます ▼▼▼
    if (!teamData) {
        // コンソールに、どのチーム名で失敗したかを出力
        console.error(`TEAM_DATAにチーム「${teamName}」が見つかりません。名前のタイプミスがないか確認してください。`);
        // 記事にはエラーメッセージを表示
        return `${teamName}のチーム情報が見つかりませんでした。`;
    }
    // ▲▲▲ ▲▲▲    
// teamData.info が基本の紹介文となる
    const baseInfo = teamData.info || `${teamName}の情報は不明です。`;

    // チームの成績記録がまだない（＝1年目の途中など）場合は、基本情報だけを返す
    if (!teamRecord || !teamRecord.history || teamRecord.history.length === 0) {
        return baseInfo;
    }

    const history = teamRecord.history;

    // --- ここからが追加情報の生成 ---
    let additionalNarrative = []; // 追加情報を入れる配列

    // 創部年数を計算 (2年目以降に意味を持つ情報)
    if (history.length > 0) {
        const establishedYear = history[history.length - 1].year;
        const yearsPassed = tournamentState.tournamentYear - establishedYear + 1;
        // 1年目の最初の大会では表示しないように、2年目以降の情報として扱う
        if (yearsPassed > 1) {
            additionalNarrative.push(`創部${yearsPassed}年目。`);
        }
    }
    
    // 昨年の成績を追加
    const lastFinishLabel = teamRecord.last?.label;
    if (lastFinishLabel && lastFinishLabel !== 'なし') {
        additionalNarrative.push(`昨年は${lastFinishLabel}。`);
    }

    // 過去最高成績を追加
    const bestFinishLabel = teamRecord.best?.label;
    if (bestFinishLabel && bestFinishLabel !== 'なし') {
        additionalNarrative.push(`過去最高は${bestFinishLabel}。`);
    }

    // 称号（Traits）を追加
    const traitDescriptions = {
        'GIANT_KILLER': '「ジャイアントキラー」の異名を持つ。',
        'REPECHAGE_KING': '「敗者復活の王」として知られる。',
    };
    if (teamRecord.teamTraits && teamRecord.teamTraits.length > 0) {
        teamRecord.teamTraits.forEach(traitId => {
            if (traitDescriptions[traitId]) {
                additionalNarrative.push(traitDescriptions[traitId]);
            }
        });
    }

    // --- 最終的な紹介文の組み立て ---
    // もし追加情報が何か一つでもあれば、基本情報に付け加える
    if (additionalNarrative.length > 0) {
        // 例：「（基本情報）。加えて、創部2年目。昨年は県大会2回戦。」のようになる
        return `${baseInfo} ${additionalNarrative.join(' ')}`;
    } 
    // 追加情報がなければ、基本情報だけを返す
    else {
        return baseInfo;
    }
}



// ▲▲▲ ▲▲▲


/**
     * AIにスポーツ新聞の一面を生成させる
     */
    /**
     * AIが生成した新聞データからHTMLを生成する
     */
    function createNewspaperHtml(articleData, matchData) {
        const { winnerName, loserName, dbMatch, matchId } = matchData;
        const idParts = matchId.split('-');
        const roundNum = idParts[0] === 'F' ? Math.log2(tournamentState.teams.length) : parseInt(idParts[1].slice(1));

        const isLateRound = roundNum >= 4;
        const containerClass = isLateRound ? 'newspaper-late' : 'newspaper-early';
        const winnerScore = dbMatch.team1 === winnerName ? dbMatch.score1 : dbMatch.score2;
        const loserScore = dbMatch.team1 === winnerName ? dbMatch.score2 : dbMatch.score1;

        return `
            <div class="newspaper-container ${containerClass}">
                <div class="newspaper-header">
                    <h2 class="newspaper-title">熱闘高校野球</h2>
                    <p class="newspaper-date">${new Date(articleData.timestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div class="newspaper-content">
                    <h1 class="newspaper-main-headline">${winnerName.slice(0, 4)}</h1>
                    <div class="newspaper-body-content">
                        <h2 class="newspaper-sub-headline">${articleData.title}</h2>
                        ${isLateRound ? '<div class="newspaper-image-placeholder">[試合の様子の写真]</div>' : ''}
                        <p class="newspaper-text">${articleData.body.replace(/\\n/g, '\n')}</p>
                        <div class="newspaper-score-box">
                            <h3>最終スコア</h3>
                            <p class="score">${winnerName} ${winnerScore} - ${loserScore} ${loserName}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
async function generateSportsNewspaper(roundNumber) {
        const numTeams = tournamentState.is16team ? 16 : 64;
        const finalRound = Math.log2(numTeams);

        const roundNameMap = {
            [finalRound]: '決勝',
            [finalRound-1]: '準決勝',
            [finalRound-2]: '準々決勝',
            [finalRound-3]: '3回戦'
        };

        const roundName = roundNameMap[roundNumber];
        if (!roundName) return null;

        const matchIdsInRound = Object.keys(tournamentState.matches).filter(id => 
            (id.includes(`-R${roundNumber}-`)) || (roundNumber === finalRound && id.includes('F-R1-'))
        );
        const results = matchIdsInRound.map(id => tournamentState.matches[id]);

        const resultsText = results.map(match => {
            const winnerRank = getRankDescription(calculateRank(match.winner, tournamentState));
            const loser = match.team1 === match.winner ? match.team2 : match.team1;
            const loserRank = getRankDescription(calculateRank(loser, tournamentState));
            const winnerScore = match.team1 === match.winner ? match.score1 : match.score2;
            const loserScore = match.team1 === match.winner ? match.score2 : match.score1;
            return `${winnerRank}・${match.winner}が${loserRank}・${loser}に ${winnerScore}-${loserScore} で勝利。`;
        }).join('\n');

        const prompt = `あなたは、読者の購買意欲を掻き立てるのが得意な、日本のスポーツ新聞の編集長です。
現在、高校野球の${tournamentState.tournamentYear}年度大会が進行中です。${roundName}の全試合が終了しました。
以下の試合結果を基に、最も衝撃的でドラマチックな出来事を一つ選び出し、それに対応する新聞の一面を飾るテキストを生成してください。

### ${roundName} 全試合結果
${resultsText}

### あなたが作成するテキスト
以下の4つの要素を、JSON形式で出力してください。
1.  **mainHeadline**: 最も重要な結果を伝える、短く、衝撃的で、扇情的な大見出し。（例：「怪物散る！」「王者、盤石の決勝へ」）
2.  **subHeadline**: mainHeadlineを補足する、少し詳しい小見出し。
3.  **photoCaption**: その日のハイライトシーンを切り取った架空の写真に対する、情景が目に浮かぶようなキャプション。（例：「あと一歩及ばず、マウンドに崩れ落ちる〇〇高校のエース△△」）
4.  **otherResults**: その他の注目すべき結果を2つ、簡潔にまとめたもの。

### 出力形式
{"mainHeadline": "...", "subHeadline": "...", "photoCaption": "...", "otherResults": ["...", "..."]}`;

        try {
            const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]) {
                const rawText = result.candidates[0].content.parts[0].text;
                const newspaperData = parseJsonFromText(rawText);
                if (newspaperData) return newspaperData;
            }
            throw new Error("AI newspaper response format error.");
        } catch (error) {
            console.error("AI newspaper generation failed:", error);
            return null;
        }
    }
/**
 * AIに組み合わせ決定時の掲示板の反応を生成させる
 * ★★★ 春・夏・秋の大会進行度に応じて指示を切り替える完成版 ★★★
 */
async function generateBracketReactionComments(state) {
    const { teams, seeds } = state;
    // チーム数が少ない場合はコメントを生成しない
    if (teams.length < 8) return []; 

    let analysis = ''; // 組み合わせ分析を入れる変数
    let commentDirections = ''; // AIへの指示を入れる変数

    // --- 1. 秋季大会の処理 ---
    if (state.currentTournament === 'autumn' && state.autumnPhase === 'main') {
        const pots = { 1: [], 2: [], 3: [], 4: [], 5: [] };
        state.teams.forEach(team => {
            for (const region of ['東部', '中部', '西部', '伊豆']) {
                const rep = state.autumnData.regions[region].finalReps.find(r => r.team === team);
                if (rep) {
                    pots[rep.rank].push(`${team}(${region}${rep.rank}位)`);
                    break;
                }
            }
        });
        
        analysis = `秋季県大会の組み合わせが決定！
- ポット1(地区1位): ${pots[1].join(', ')}
- ポット2(地区2位): ${pots[2].join(', ')}
- ポット3(地区3位): ${pots[3].join(', ')}
- ポット4(地区4位): ${pots[4].join(', ')}
- ポット5(敗者復活): ${pots[5].join(', ')}`;

        commentDirections = `
- 「地区1位と敗者復活組がいきなり当たるのか！」「地区間のレベル差が試されるな」といったポット制や地区対決に関する反応。
- ポット1の強豪校がどこに入るか、そのブロックの他のチームへの同情。
- 自分の応援するチームがどのポットから、どのブロックに入ったかに対する一喜一憂。`;

    // --- 2. 春季大会の処理 ---
    } else if (state.currentTournament === 'spring') {
        
        // --- 2A. 地区予選 ---
        if (state.springPhase === 'regional_qualifiers') {
            analysis = `春季地区予選の組み合わせが決定！県大会本戦への出場権16枠をかけた戦いが始まる。`;
            commentDirections = `
- 「うちの地区、激戦区すぎだろ…」「県大会出るの大変だな」といった、地区予選の厳しさに関するコメント。
- シード校以外の有力校がどの地区にいるかについての言及。「〇〇と△△が同じ地区とかマジかよ」など。
- 無名校にとってはチャンスであることへの期待や感想。`;
        } 
        // --- 2B. 県大会1回戦 ---
        else if (state.springPhase === 'main_round1') {
            analysis = `春季県大会1回戦、予選を勝ち上がった16校の組み合わせが決定！シード校への挑戦権を掴むのはどこだ。`;
            commentDirections = `
- 「予選突破組同士の潰し合いか、面白いな」「ここ勝てばシード校とやれるのか」といった、1回戦ならではの反応。
- 地区予選を勝ち上がってきた勢いのあるチームへの注目。「予選で〇〇を倒した△△、どこまで行くか楽しみ」など。
- どのチームがシード校を脅かす存在になりそうかという予想。`;
        } 
        // --- 2C. 県大会2回戦 (シード校登場) ---
        else if (state.springPhase === 'main_round2') {
            const numBlocks = Math.ceil(teams.length / 16);
            let blockAnalyses = [];
            for(let i=0; i<numBlocks; i++){
                const blockName = String.fromCharCode(65+i);
                const blockTeams = teams.slice(i*16, (i+1)*16);
                if(blockTeams.length === 0) continue;
                const isStrong = (team) => seeds.includes(team) || DETAILED_TEAM_DATA[team] || TEAM_DATA[team].popularity;
                const strongTeams = blockTeams.filter(isStrong);
                blockAnalyses.push(`- ${blockName}ブロック: 有力校 ${strongTeams.length}チーム (${strongTeams.join(', ')})`);
            }
            analysis = `春季県大会2回戦、シード校と予選突破校の組み合わせが決定！\n${blockAnalyses.join('\n')}`;
            commentDirections = `
- 「シード校 vs 予選突破組」という構図への期待感。「〇〇（シード校）といきなり当たるとかクジ運なさすぎだろ」など。
- 有力校が固まった「死のブロック」への反応。「Aブロック、事実上の決勝戦じゃねえか」など。
- シード校が順当に勝つか、予選を勝ち上がったチームが「ジャイキリ」を起こすかという予想。`;
        }

    // --- 3. 夏季大会 (および上記以外のケース) の処理 ---
    } else {
        const numBlocks = Math.ceil(teams.length / 16);
        let blockAnalyses = [];
        for(let i=0; i<numBlocks; i++){
            const blockName = String.fromCharCode(65+i);
            const blockTeams = teams.slice(i*16, (i+1)*16);
            if(blockTeams.length === 0) continue;
            const isStrong = (team) => seeds.includes(team) || DETAILED_TEAM_DATA[team] || TEAM_DATA[team].popularity || TEAM_DATA[team].best.includes('甲子園');
            const strongTeams = blockTeams.filter(isStrong);
            blockAnalyses.push(`- ${blockName}ブロック: 有力校 ${strongTeams.length}チーム (${strongTeams.join(', ')})`);
        }
        analysis = `夏の選手権、組み合わせが決定！\n${blockAnalyses.join('\n')}`;
        commentDirections = `
- 「ここのブロックやばすぎる」「死のブロックだな」といった、有力校が固まったブロックへの反応。
- 「〇〇は決勝までフリーパスかよ」といった、有力校が少ないブロックへの反応。
- 自分の応援するチームが厳しいブロックに入ったことへの絶望や、楽なブロックに入ったことへの期待。
- 3年生最後の夏、という文脈でのドラマへの期待。`;
    }

    // --- プロンプトの組み立て ---
    const prompt = `あなたは、匿名掲示板に集う、様々な立場の高校野球ファンです。
以下のトーナメントの組み合わせ分析を読んで、ファンらしいリアルな短いコメントを5～7個生成してください。

### 組み合わせ分析
${analysis}

### コメントの方向性
${commentDirections}

### 出力形式
必ず以下のJSON配列形式で出力してください。
[
  {"personality": "匿名ファン", "comment": "（コメント本文）"},
  {"personality": "野球通", "comment": "（コメント本文）"},
  {"personality": "悲観的なファン", "comment": "（コメント本文）"}
]`;

    // --- AIへのリクエストと結果の処理 ---
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const rawText = result.candidates[0].content.parts[0].text;
            const commentsJson = parseJsonFromText(rawText);
            if (Array.isArray(commentsJson)) {
                return commentsJson.map(c => ({
                    id: crypto.randomUUID(),
                    personality: c.personality,
                    text: c.comment,
                    timestamp: Date.now(),
                    replies: []
                }));
            }
        }
        throw new Error("AIからの応答が予期した形式ではありません。");
    } catch (error) {
        console.error("AI組み合わせ反応コメントの生成に失敗しました:", error);
        return [];
    }
}
/**
     * AIにスキップしたラウンドのダイジェスト記事を生成させる
     */
    async function generateSkipRoundSummaryArticle(roundNumber, results) {
        // 最も番狂わせが大きかった試合を1つ選出
        const biggestUpset = results.filter(r => r.rankDiff >= 2).sort((a,b) => b.rankDiff - a.rankDiff)[0];
        
        let highlightText = "シード校や有力校が順当に勝ち進みました。";
        if (biggestUpset) {
            highlightText = `最大の波乱は${biggestUpset.winnerName}が強豪${biggestUpset.loserName}を${biggestUpset.winnerScore}-${biggestUpset.loserScore}で破った一戦でした。`;
        }

        const prompt = `あなたは高校野球専門のAI記者です。
現在、${tournamentState.tournamentYear}年度${tournamentNameMap[tournamentState.currentTournament]}が進行中です。
${roundNumber}回戦の全試合が終了しました。以下のハイライトを元に、簡潔なダイジェスト記事を生成してください。

### ${roundNumber}回戦ハイライト
- ${highlightText}
- 次のラウンドでは、勝ち上がった猛者たちによる更なる激戦が期待されます。

### 執筆指示
- 上記のハイライトを自然な文章にまとめてください。
- タイトルは「${roundNumber}回戦が終了！波乱は起きるか？」のように、次への期待感を煽るものにしてください。

### 出力形式
JSON形式で出力してください: {"title": "記事のタイトル", "body": "記事の本文"}`;

        try {
            const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]) {
                const article = parseJsonFromText(result.candidates[0].content.parts[0].text);
                if (article) return { ...article, timestamp: Date.now() };
            }
            throw new Error("AI summary response format error.");
        } catch (error) {
            console.error("AI summary article generation failed:", error);
            return { title: "ダイジェスト記事生成エラー", body: "AI記者との通信に失敗しました。", timestamp: Date.now(), error: true, errorId: `skip-summary-${roundNumber}` };
        }
    }
/**
     * AIにナムコグループからのお知らせを生成させる
     */
    async function generateNamcoNews(state, type, matchData = null) {
        const namcoSchools = ["初星学園", "765総合高校", "283学園", "美城学園", "283学園B"];
        let prompt = '';

        if (type === 'bracket') {
            const participatingSchools = state.teams.filter(t => namcoSchools.includes(t));
            if(participatingSchools.length === 0) return null;

            const matchups = participatingSchools.map(school => {
                const schoolIndex = state.teams.indexOf(school);
                if (schoolIndex === -1) return null;
                const opponentIndex = schoolIndex % 2 === 0 ? schoolIndex + 1 : schoolIndex - 1;
                const opponentName = state.teams[opponentIndex];
                return `- ${school} の初戦は ${opponentName} と対戦します。`;
            }).filter(item => item !== null).join('\n');

            prompt = `あなたはナムコグループの広報担当者です。
夏の高校野球選手権大会の組み合わせが決定しました。
以下の情報に基づき、グループの公式サイトに掲載する、プロフェッショナルで丁寧な「お知らせ」記事を生成してください。

### 各校の初戦の組み合わせ
${matchups}

### 記事のポイント
- タイトルは「野球部（夏の選手権大会）組み合わせ決定のお知らせ」とする。
- 本文では、抽選会が行われたことと、上記の組み合わせが決定したことを報告してください。
- 最後に、系列校野球部への応援をお願いする言葉で締めくくる。
- 全体的に、企業の公式発表としてふさわしい、丁寧でフォーマルな文体にすること。

### 出力形式
以下のJSON形式で、タイトルと本文を生成してください。
{"title": "記事のタイトル", "body": "記事の本文（改行は\\nを使用）"}`;
        } else if (type === 'matchResult') {
            const { winnerName, loserName, dbMatch } = matchData;
            const isCivilWar = (winnerName === '283学園' && loserName === '283学園B') || (winnerName === '283学園B' && loserName === '283学園');

            if (isCivilWar) {
                // ... (省略)
            } else {
                const namcoTeam = namcoSchools.includes(winnerName) ? winnerName : loserName;
                const opponent = namcoSchools.includes(winnerName) ? loserName : winnerName;
                const result = namcoSchools.includes(winnerName) ? '勝利' : '敗北';
                const score = namcoSchools.includes(winnerName) ? `${dbMatch.score1}-${dbMatch.score2}` : `${dbMatch.score2}-${dbMatch.score1}`;

                prompt = `あなたはナムコグループの広報担当者です。
本日行われた、夏の高校野球選手権大会の試合結果について、公式サイトに掲載する「お知らせ」記事を生成してください。

### 試合情報
- 系列校: ${namcoTeam}
- 対戦相手: ${opponent}
- 結果: ${namcoTeam}の${result}
- スコア: ${score}

### 記事のポイント
- タイトルは「野球部（夏の選手権大会）試合結果のお知らせ」とする。
- 本文では、まず試合が行われたことと、結果を簡潔に報告する。
- **もし勝利した場合:**
  - 応援への感謝を述べ、次の試合への意気込みを語る（例：「次戦もチーム一丸となって勝利を目指します」）。
- **もし敗北した場合:**
  - 選手たちの健闘を称え、応援への感謝を深く述べる（例：「皆様の熱い声援が、選手の力となりました。心より感謝申し上げます」）。
  - 新チームでの再起を誓う言葉で締めくくる。
- 全体的に、企業の公式発表としてふさわしい、丁寧でフォーマルな文体にすること。

### 出力形式
以下のJSON形式で、タイトルと本文を生成してください。
{"title": "記事のタイトル", "body": "記事の本文（改行は\\nを使用）"}`;
            }
        }

        if (!prompt) return null;

        try {
            const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]) {
                const rawText = result.candidates[0].content.parts[0].text;
                const newsJson = parseJsonFromText(rawText);
                if (newsJson) {
                    return { ...newsJson, timestamp: Date.now() };
                }
            }
            throw new Error("AIからの応答が予期した形式ではありません。");
        } catch (error) {
            console.error("ナムコニュースの生成に失敗しました:", error);
            return null;
        }
    }
/**
 * AIに各ブロックの勢力図を分析させ、ナレーション原稿を生成させる（データ分析強化版）
 * @param {object} state - tournamentState
 * @returns {Promise<object|null>}
 */
/**
 * AIに各ブロックの勢力図を分析させ、ナレーション原稿を生成させる（ハイブリッド版・APIエラー対策済み）
 * @param {object} state - tournamentState
 * @returns {Promise<object|null>}
 */
async function generateBlockAnalysisArticle(state) {
    const { teams, seeds } = state;
    const blocks = { A: [], B: [], C: [], D: [] };
    teams.forEach((team, i) => {
        if (i < 16) blocks.A.push(team);
        else if (i < 32) blocks.B.push(team);
        else if (i < 48) blocks.C.push(team);
        else blocks.D.push(team);
    });

    const blockAnalysisData = {};
    for (const blockId in blocks) {
        const blockTeams = blocks[blockId];
        // ▼▼▼ ここからが新しい処理 ▼▼▼
        const teamDetails = blockTeams.map(teamName => {
            const rank = calculateRank(teamName, state);
            const isSeed = seeds.includes(teamName);
            // シード校か、A,Bランクの強豪校の場合のみ、詳細な情報を渡す
            if (isSeed || ['A', 'B'].includes(rank)) {
                const info = TEAM_DATA[teamName]?.info || '';
                return `${teamName}(${rank}${isSeed ? 'S' : ''})[背景: ${info}]`;
            } else {
                return `${teamName}(${rank})`;
            }
        }).join(', ');
        // ▲▲▲
        blockAnalysisData[blockId] = teamDetails;
    }

    const prompt = `あなたは高校野球の解説者です。以下の各ブロックのチームリストを分析し、それぞれの見どころを**150字程度**のナレーション原稿にまとめてください。

### 分析対象ブロック (チーム名とランク、Sはシード校、[]内は注目校の背景情報)
- **Aブロック:** ${blockAnalysisData.A}
- **Bブロック:** ${blockAnalysisData.B}
- **Cブロック:** ${blockAnalysisData.C}
- **Dブロック:** ${blockAnalysisData.D}

### 指示
- **物語を重視:** [背景]情報が提供されている注目校を中心に、そのチームが持つ物語や背景（例：古豪の復活、王者の苦悩）に触れながら解説してください。
- **簡潔に:** 全体のナレーションは150字程度に収めてください。
- 最も激戦区だと思われる「死のブロック」を特定してください。
- 4ブロック分、必ず全てのナレーションを生成してください。

### 出力形式 (JSON)
{
  "A": "（Aブロックのナレーション）",
  "B": "（Bブロックのナレーション）",
  "C": "（Cブロックのナレーション）",
  "D": "（Dブロックのナレーション）"
}`;

    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        return parseJsonFromText(result.candidates[0].content.parts[0].text);
    } catch (error) {
        console.error("AIブロック分析記事の生成に失敗:", error);
        return null;
    }
}
/**
 * 抽選会後の主将インタビューを生成・表示する（ランク差対応・最終版）
 * @param {Array<string>} teamPositions - 抽選会で決定した最終的なチームの組み合わせ
 */
async function generateCaptainInterviews(teamPositions) {
    const interviewModal = document.getElementById('interview-modal');
    const interviewContent = document.getElementById('interview-content');
    interviewContent.innerHTML = `<div class="loader">AI記者が主将インタビューを作成中...</div>`;
    interviewModal.classList.remove('hidden');

    const matchups = [];
    for(let i=0; i<64; i+=2){
        matchups.push({team1: teamPositions[i], team2: teamPositions[i+1]});
    }

    // 注目カードを3つに増やす
    const notableMatchups = shuffleArray(matchups).slice(0, 3);

    // ▼▼▼ ここからが新しい処理 ▼▼▼
    const matchupsWithRanks = notableMatchups.map(m => ({
        team1: m.team1,
        rank1: calculateRank(m.team1, tournamentState),
        team2: m.team2,
        rank2: calculateRank(m.team2, tournamentState)
    }));
    const promptDataText = matchupsWithRanks.map(m => 
        `- ${m.team1} (ランク: ${m.rank1}) vs ${m.team2} (ランク: ${m.rank2})`
    ).join('\n');
    // ▲▲▲

    const prompt = `あなたは高校野球専門のAI記者です。夏の大会の組み合わせ抽選会が終了しました。
以下の注目カードについて、両チームの主将になりきって、抽選結果に対するリアルな反応を語ってください。

### 注目カードと各チームのランク
${promptDataText}

### あなたがなりきる「高校生の主将」の思考パターン
- **格下の相手と当たった場合 (例: Aランク vs Dランク):**
  - 少し安堵した様子を見せる。「正直、ホッとした」「自分たちの野球をすれば負けない」
  - しかし油断は禁物だと付け加える。「どのチームも強いので、一戦必勝で戦いたい」
- **格上の相手と当たった場合 (例: Eランク vs Aランク):**
  - 明らかに絶望したり、驚いたりする。「まさか初戦で当たるとは…」「正直、厳しい相手」
  - しかし、挑戦者として「胸を借りるつもりで全力でぶつかりたい」「一矢報いたい」と闘志も見せる。
- **実力が拮抗している相手と当たった場合 (例: Cランク vs Cランク):**
  - 「ここが最初の山場になる」「厳しい戦いになることは覚悟している」と、相手への敬意を示す。
  - 「最高の試合をしたい」と、ライバルとの対戦を心待ちにしている様子を見せる。

### 指示
- 上記の思考パターンに基づき、各カードの両主将のコメントを生成してください。
- チームの背景（例：王者、古豪）も少しだけコメントに反映させてください。

### 出力形式 (JSON配列)
[
    {"team": "〇〇高校", "captain_comment": "（主将のコメント）"},
    {"team": "△△高校", "captain_comment": "（主将のコメント）"}
]`;

    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        const interviews = parseJsonFromText(result.candidates[0].content.parts[0].text);

        if (interviews && Array.isArray(interviews)) {
            interviewContent.innerHTML = interviews.map(iv => `
                <div class.p-4 bg-gray-50 rounded-lg">
                    <h4 class="font-bold text-lg text-gray-800">${iv.team} 主将</h4>
                    <p class="mt-1 text-gray-700">「${iv.captain_comment}」</p>
                </div>
            `).join('');
        } else {
            throw new Error("Parsed JSON is not an array or is null.");
        }
    } catch (e) {
        interviewContent.innerHTML = `<p class="text-center text-red-600">インタビューの生成に失敗しました。</p>`;
        console.error(e);
    }
    
    document.getElementById('close-interview-btn').onclick = () => {
        interviewModal.classList.add('hidden');
        document.getElementById('lottery-modal').classList.add('hidden');
        SoundManager.stopBgm();
        createNewTournament(false, 'summer', teamPositions);
    };
}
/**
 * AIに掲示板の返信を生成させる（最終版）
 * 最新のデータ構造と、脱線防止を強化したプロンプトを使用する
 */
/**
 * AIに掲示板の返信を生成させる（最新の環境に適合した最終版）
 */
async function generateBbsReply(parentCommentId, userReplyText, bbsType, aiPersona, context) {
    const commentSource = bbsType === 'general' ? tournamentState.bbsComments : tournamentState.daiyaBbsComments;
    const parentComment = findCommentById(commentSource, parentCommentId);
    if (!parentComment) return null;

    // --- 1. AIに渡すための「文脈」を収集する ---
    const userReplyObject = { id: 'temp_user_reply', personality: 'あなた', text: userReplyText, replies: [] };
    parentComment.replies.push(userReplyObject);
    const conversationHistory = formatConversationHistory(commentSource, 'temp_user_reply');
    parentComment.replies.pop();

    const mentionedTeams = new Set();
    conversationHistory.split('\n').forEach(line => {
        INITIAL_TEAM_POOL.forEach(team => {
            if (line.includes(team)) {
                mentionedTeams.add(team);
            }
        });
    });

    // --- 2. AIに与える「知識」の部分を作成する ---
    let teamInfoPromptPart = '';
    if (mentionedTeams.size > 0) {
        teamInfoPromptPart = '### 関連チームの背景情報\n';
        mentionedTeams.forEach(teamName => {
            const teamData = TEAM_DATA[teamName];
            const teamRecord = tournamentState.teamRecords[teamName];
            // ★最新のアナウンサー関数を活用
            const dynamicInfo = generateDynamicTeamInfo(teamName, teamData, teamRecord);
            teamInfoPromptPart += `- **${teamName}**: ${dynamicInfo}\n`;
        });
    }

    // --- 3. 最終的なプロンプトを組み立てる（★脱線防止策を適用） ---
    const prompt = `あなたは、匿名掲示板のキャラクター「${aiPersona}」です。あなたは今、他のユーザーと日本の高校野球について会話しています。
あなたの唯一の仕事は、会話の流れとあなたの知識に基づき、キャラクターになりきって自然な返信をすることです。野球以外の話題には絶対に触れないでください。
---
### **ステップ1：現在の会話状況を理解する**
- **これまでの会話の流れ**:
${conversationHistory}
- **あなたのキャラクター**: ${aiPersona}
- **現在の大会状況**: ${context.tournamentSummary}
---
### **ステップ2：関連情報を思い出す**
${teamInfoPromptPart}
---
### **ステップ3：返信する**
上記のステップ1と2の情報を元に、会話の最後の発言「${userReplyText}」に対して、あなたのキャラクターとして最も自然で的を射た返信を生成してください。
- **指示**:
  - 必ず相手の発言に直接応答することから始めること。
  - 応答の根拠として、ステップ2の「関連情報」を自然な形で会話に含めること。
  - 相手が話していない無関係なチームや試合の情報を一方的に解説しないこと。
---
### **ステップ4：出力形式**
【最重要】必ず以下のJSON形式"のみ"で出力すること。解説や前置きは一切不要です。
{"comment": "（あなたの返信本文）"}`;
    
    // --- 4. AIを呼び出し、結果を処理する ---
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const rawText = result.candidates[0].content.parts[0].text;
            const replyJson = parseJsonFromText(rawText);
            if (replyJson && replyJson.comment) {
                return {
                    id: crypto.randomUUID(),
                    personality: aiPersona,
                    text: replyJson.comment,
                    timestamp: Date.now(),
                    replies: []
                };
            }
        }
        throw new Error("AIの応答形式が不正です。");
    } catch (error) {
        console.error("AI返信コメントの生成に失敗しました:", error);
        return null;
    }
}

/**
 * Takes a user's comment and generates multiple AI fan replies to it.
 */
/**
 * Generates multiple AI fan replies to a user's top-level comment,
 * using the same advanced logic as the in-thread reply function.
 */
/**
 * ユーザーのコメント一つに対して、複数のAIファンからの返信を一度に生成する
 * (★チームの敗退状況も認識する最終版)
 */
async function generateMultipleReplies(userCommentText) {
    const conversationHistory = `あなた: 「${userCommentText}」`;

    // --- AIに与える「知識」の部分を作成（完全版） ---
    const mentionedTeams = new Set();
    const mentionedPlayers = new Set(); // ★言及された選手名を保存するSet

    INITIAL_TEAM_POOL.forEach(team => {
        if (userCommentText.includes(team)) {
            mentionedTeams.add(team);
            // チーム名が言及されたら、そのチームの全選手を潜在的な調査対象とする
            const detailedData = DETAILED_TEAM_DATA[team];
            if (detailedData) {
                detailedData.players.forEach(p => mentionedPlayers.add({name: p.name, team: team}));
            }
        } else {
            // チーム名がなくても、選手名単体で言及されている場合
            const detailedData = DETAILED_TEAM_DATA[team];
            if(detailedData) {
                detailedData.players.forEach(p => {
                    if (userCommentText.includes(p.name)) {
                        mentionedPlayers.add({name: p.name, team: team});
                    }
                });
            }
        }
    });

    let teamInfoPromptPart = '### 参考情報：関連チームと選手の状況\n';
    
    // チーム全体の状況
    mentionedTeams.forEach(teamName => {
        const teamData = TEAM_DATA[teamName];
        const teamRecord = tournamentState.teamRecords[teamName];
        const dynamicInfo = generateDynamicTeamInfo(teamName, teamData, teamRecord);
        const fate = getTeamFateSummary(teamName);
        teamInfoPromptPart += `- **${teamName}**: ${dynamicInfo} (今大会の状況: ${fate})\n`;
    });

    // 言及された全選手の個人成績
    if (mentionedPlayers.size > 0) {
        teamInfoPromptPart += `\n- **主な選手の今大会成績**:\n`;
        mentionedPlayers.forEach(playerInfo => {
            const statsSummary = getPlayerTournamentStatsSummary(playerInfo.name, playerInfo.team);
            if (statsSummary) {
                teamInfoPromptPart += `  - ${statsSummary}\n`;
            }
        });
    }

    // --- プロンプト作成 ---
    const prompt = `あなたは、匿名掲示板に集う、様々な立場の高校野球ファンです。
ユーザー「あなた」の投稿した以下のコメントに対し、4人の異なるキャラクターとして返信してください。
### **ユーザーのコメント**: 「${userCommentText}」
### **現在の大会状況**: ${getTournamentStatusSummary()}
${teamInfoPromptPart}
### **指示**:
- 各キャラクターの返信は、必ずユーザーのコメント内容に直接関連していること。
- **【重要】**: あなたの知識である「参考情報」を最大限に活用し、具体的なチーム状況や選手成績に触れながら、的確な返信をすること。
- **【注意】**: まだ大会序盤である（例：2試合しか終わっていない）ことを考慮し、「本塁打が少ない」といった早計な批判は避けること。
---
---### **ステップ4：出力形式**
【最重要】必ず以下のJSON配列形式"のみ"で出力すること。
[
    {"personality": "熱狂的なファン", "comment": "（コメント本文）"},
    {"personality": "上から目線の解説者", "comment": "（コメント本文）"},
    {"personality": "アンチ", "comment": "（コメント本文）"},
    {"personality": "ライバル校のファン", "comment": "（コメント本文）"}
]`;
    
    // --- 4. Call AI and Process Response ---
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const rawText = result.candidates[0].content.parts[0].text;
            const commentsJson = parseJsonFromText(rawText);
            if (Array.isArray(commentsJson)) {
                return commentsJson.map(c => ({
                    id: crypto.randomUUID(),
                    personality: c.personality,
                    text: c.comment,
                    timestamp: Date.now(),
                    replies: []
                }));
            }
        }
        throw new Error("AI response format error.");
    } catch (error) {
        console.error("AI multi-reply generation failed:", error);
        return [];
    }
}
/**
 * ゲーム内の試合結果に対する、なんJまとめサイト風のスレッドをAIに生成させる（★善戦評価ロジック・最終版）
 */
async function generateGameMatchBbsComments(matchContext) {
    // contextから必要な基本情報を取り出す
    const { winnerName, loserName, dbMatch, playerStatsText, playByPlayText, winnerJourney, loserJourney, nextOpponent, nextOpponentJourney, winnerLineupChanges, loserLineupChanges } = matchContext;
    const score = `${dbMatch.score1}-${dbMatch.score2}`;
    
    // ★★★ ここからが修正箇所 ★★★
    // この関数内で、プロンプトに必要な情報を改めて生成する
    const winnerData = TEAM_DATA[winnerName];
    const loserData = TEAM_DATA[loserName];
    const winnerDynamicInfo = generateDynamicTeamInfo(winnerName, winnerData, tournamentState.teamRecords[winnerName]);
    const loserDynamicInfo = generateDynamicTeamInfo(loserName, loserData, tournamentState.teamRecords[loserName]);
    const winnerRank = calculateRank(winnerName, tournamentState);
    const loserRank = calculateRank(loserName, tournamentState);

    // ★★★ ここからが修正箇所 ★★★
    // 次の対戦相手に関するテキストを、3つのパターンに応じて準備する
    let nextOpponentText = '次の相手は未定やな。'; // デフォルト (なんJ風の語尾)
    if (nextOpponent) {
        // パターン1: 対戦相手が決まっている場合
        if (nextOpponent.opponentName && nextOpponent.opponentName !== '（未定）') {
            nextOpponentText = `次の${nextOpponent.roundName}の相手は${nextOpponent.opponentName}(ランク:${nextOpponent.opponentRank})か。`;
        } 
        // パターン2: 対戦相手は未定だが、どの試合の勝者と当たるか分かっている場合
        else if (nextOpponent.decidingMatch) {
            const dm = nextOpponent.decidingMatch;
            nextOpponentText = `次の${nextOpponent.roundName}の相手は、${dm.team1}(${dm.rank1}ランク)と${dm.team2}(${dm.rank2}ランク)の勝者やな。`;
        }
    }
    const nextOpponentJourneyText = (nextOpponent && nextOpponentJourney) 
        ? `ちなみに、その${nextOpponent.opponentName}のここまでの軌跡は「${nextOpponentJourney}」。` 
        : '';
    // ★★★ 修正箇所はここまで ★★★
    // ★★★ 修正箇所はここまで ★★★
    const prompt = `あなたは、静岡県の高校野球を長年見続けている、なんJの玄人野球ファンです。あなたは特に「背番号」が持つ意味に詳しく、選手の背景を深く読み解きます。
以下の試合データを多角的に分析し、玄人たちのリアルな会話を35個前後生成してください。

### 参考情報：高校野球における背番号の意味
- **[#1]**: チームの絶対的エース投手。
- **[#2-9]**: 基本的にレギュラーの野手陣（正捕手、内野手、外野手）。
- **[#10], [#11]**: エースに次ぐ控え投手。
- **[#12]以降**: 控え選手。時に監督の秘蔵っ子や、期待の1・2年生が含まれる。

### データ1：前試合からのスタメン変更
- **${winnerName}**: ${winnerLineupChanges || '情報なし'}
- **${loserName}**: ${loserLineupChanges || '情報なし'}

### データ2：試合結果
- **勝利:** ${winnerName} (ランク: ${winnerRank})
- **敗北:** ${loserName} (ランク: ${loserRank})
- **スコア:** ${score}
- **ユーザーによる試合の決め手:** ${dbMatch.summary || '特になし'}

### チームの背景
- **${winnerName}**: ${winnerDynamicInfo}
- **${loserName}**: ${loserDynamicInfo}

### データ3：この試合の個人成績 (最終結果)
${playerStatsText || '詳細な個人成績データはありません。'}

### データ4：この試合の主な流れ (プレーバイプレー)
${playByPlayText || '詳細な試合経過データはありません。'}

### 参考情報：トーナメント全体の状況
- **${winnerName}の軌跡**: ${winnerJourney || '今大会初戦'}
- **次の試合**: ${nextOpponentText} ${nextOpponentJourneyText}

### 指示
あなたは今、上記の全データを眺めながら、他のファンと会話しています。以下の指示に従って、リアルなコメントを生成してください。

1.  **【超重要：高度な分析】**
    「データ2：最終結果」と「データ3：プレーバイプレー」を比較し、最終成績が良い選手でもチャンスで凡退していないかなど、結果だけでは分からない深い分析コメントを生成してください。（例：「品川は4打数2安打やけど、チャンスで凡退しとるからワイは評価せん」）

2.  **【善戦の評価】** ★★★この指示ブロックが新しい機能です★★★
    もし**ランクの低いチーム（敗北側）がランクの高いチーム（勝利側）相手に善戦（例：5点差以内での敗北、またはプレーバイプレーから読み取れる終盤までの接戦）**した場合、その健闘を称えるコメントを必ず含めてください。
    - 例：「負けはしたけど、格上相手によくやったわ」「〇〇（敗北校）は来年期待できるな」「まさかここまで苦戦するとは思わなかった」

3.  **【プレーへの言及】**
    「データ3：プレーバイプレー」から印象的なプレーを抜き出し、「〇回の△△のプレーは良かった/悪かった」といった、特定のプレーに言及するコメントを生成してください。

4.  **【次戦の展望】**
    「参考情報」を元に、次の対戦相手の強さや勝ち上がり方に触れ、「次は厳しい」「相手も苦戦しとるからワンチャンある」といった、次戦を予想する会話を生成してください。

5.  その他、なんJらしい煽り、称賛、達観したコメントなどを自由に織り交ぜてください。安価（>>）を使った会話も必ず含めてください。

6. ランク名をそのまま使うのではなく、eランクは無名校、dランクは挑戦校、cランクは中堅校、bランクは強豪校、Aランクは名門校と言い換えてください。

### 出力形式【最重要】
解説や前置きは一切不要です。必ず以下のJSON形式"のみ"で出力してください。
{
  "threadTitle": "（生成したスレッドタイトル）",
  "comments": [
    {"personality": "1: 風吹けば名無し", "comment": "（スレ主のコメント）"},
    {"personality": "2: 風吹けば名無し", "comment": "（住民2のコメント）"}
  ]
}`;

    // AIへのリクエスト部分は変更なし
    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const rawText = result.candidates[0].content.parts[0].text;
            const bbsJson = parseJsonFromText(rawText);
            if (bbsJson && bbsJson.threadTitle && Array.isArray(bbsJson.comments)) {
                return {
                    title: bbsJson.threadTitle,
                    comments: bbsJson.comments.map(c => ({
                        id: crypto.randomUUID(),
                        personality: c.personality,
                        text: c.comment,
                        timestamp: Date.now()
                    }))
                };
            }
        }
        throw new Error("AI response format error.");
    } catch (error) {
        console.error("AI game match BBS generation failed:", error);
        return null;
    }
}
/**
 * 現実のニュースヘッドラインに対する、なんJ風の掲示板コメントをAIに生成させる
 * @param {string} headline - 現実のニュースの見出し
 * @param {string} category - ニュースのカテゴリ
 * @returns {Promise<Array|null>} コメントオブジェクトの配列
 */
async function generateRealNewsBbsComments(headline, category) {
    let personaPrompt = `あなたは、日本の匿名掲示板「なんでも実況J（なんJ）」の住民です。あなたは少し皮肉屋で、ネットスラングを多用し、あらゆる話題に短いコメントを書き込みます。`;
    let instructions = ``;
    switch (category) {
        case '政治': instructions = `政治ニュースに詳しい住民として、与党や野党を煽ったり、将来を悲観したり、達観したようなコメントをしてください。`; break;
        case '芸能': instructions = `芸能ニュースが大好きな野次馬として、「〇〇ロスだわ」「どうせすぐ別れる」といった、お祝いと嫉妬が入り混じったコメントをしてください。`; break;
        case '学歴': instructions = `学歴コンプレックスを持つ住民として、「F欄のワイ、高みの見物」「結局は学歴よりコミュ力」といった、自虐や持論を展開してください。`; break;
        default: instructions = `一般的な住民として、ニュースに反応してください。`; break;
    }
    
    const prompt = `${personaPrompt}

以下の【${category}】のニュースヘッドラインについて、**リアルタイムでスレッドが進行していくかのように**、自然な流れで**30〜35個**の掲示板の反応を生成してください。

### ニュースヘッドライン
${headline}

### スレッド進行の指示
1.  **序盤 (1〜5レス):** スレ主の投稿に対し、即座に食いつく第一陣の反応。「マジか」「草」「また〇〇か」といった短いコメントが中心。
2.  **中盤 (6〜15レス):** 少し冷静になった住民たちが、ニュースに対して様々な角度からコメントを始める。肯定、否定、煽り、全く関係ない脱線などを織り交ぜる。**「>>1」「>>5」のような安価（アンカー）を使って、他のコメントに返信するやり取りを必ず含めること。**
3.  **終盤 (16レス以降):** ある程度議論が出尽くした後の、まとめのようなコメントや、飽きてきた住民によるおふざけが始まる。
4.　**最終盤 (26レス以降):** スレも混沌としてきて、関係ない話題を持ってくる者や、勝手にコンプレックスを刺激され発狂するもの、ただの荒らしなどが湧き始め、グダグダになり解散する。


### 出力形式（JSON配列）
[
    {"personality": "1: 風吹けば名無し", "comment": "（スレ主のコメント）"},
    {"personality": "2: 風吹けば名無し", "comment": "（住民2のコメント）"},
    {"personality": "3: 風吹けば名無し", "comment": "（住民3のコメント）"},
    ...
]`;

    try {
        const response = await fetchWithRetry({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]) {
            const rawText = result.candidates[0].content.parts[0].text;
            const commentsJson = parseJsonFromText(rawText);
            if (Array.isArray(commentsJson)) {
                return commentsJson.map(c => ({
                    id: crypto.randomUUID(),
                    personality: c.personality,
                    text: c.comment,
                    timestamp: Date.now()
                }));
            }
        }
        throw new Error("AI response format error.");
    } catch (error) {
        console.error("AI real news BBS generation failed:", error);
        return null;
    }
}
/**
 * 試合の全情報を集約した「matchContext」オブジェクトを生成する司令塔（★ハイライト情報生成を追加）
 * @param {string} matchId - 対象の試合ID
 * @param {string} winnerName - 勝者名
 * @returns {object} - AIに渡すための全ての情報が詰まったオブジェクト
 */
function createMatchContext(matchId, winnerName, state) { // ★引数に state を追加
    const dbMatch = findMatchById(matchId, state); // ★findMatchById にも state を渡す
    if (!dbMatch) return null;

    const loserName = dbMatch.team1 === winnerName ? dbMatch.team2 : dbMatch.team1;
    // ★各ヘルパー関数に、受け取った state を引き渡す
    const nextOpponentInfo = findNextOpponent(winnerName, matchId, state);
    let nextOpponentJourney = null;
    if (nextOpponentInfo && nextOpponentInfo.opponentName && !['（未定）', '優勝'].includes(nextOpponentInfo.opponentName)) {
        nextOpponentJourney = getCurrentTournamentPerformance(nextOpponentInfo.opponentName, matchId, state);
    }

    const { highlights, keyPlayerNames } = createHighlightsText(dbMatch, winnerName, state); // ★createHighlightsText にも state を渡す

    const context = {
        winnerName,
        loserName,
        dbMatch,
        matchId,
        state: state, // ★AI記者たちも state を使えるように含めておく
        winnerData: TEAM_DATA[winnerName],
        loserData: TEAM_DATA[loserName],
        winnerDetailedData: DETAILED_TEAM_DATA[winnerName],
        loserDetailedData: DETAILED_TEAM_DATA[loserName],
        playerStatsText: dbMatch.details ? formatPlayerStatsForPrompt(dbMatch) : null,
        playByPlayText: dbMatch.details ? generatePlayByPlayText(dbMatch, state) : null,
        winnerJourney: getCurrentTournamentPerformance(winnerName, matchId, state),
        loserJourney: getCurrentTournamentPerformance(loserName, matchId, state),
        winnerLineupChanges: dbMatch.details ? analyzeLineupChanges(winnerName, dbMatch, state) : "比較データなし",
        loserLineupChanges: dbMatch.details ? analyzeLineupChanges(loserName, dbMatch, state) : "比較データなし",
        nextOpponent: nextOpponentInfo,
        nextOpponentJourney: nextOpponentJourney,
        highlights: highlights,
        keyPlayerNames: keyPlayerNames
    };
    return context;
}

/**
 * 前試合と今試合のスタメンを比較し、変更点を要約する
 * @param {string} teamName - 分析対象のチーム名
 * @param {object} dbMatch - 現在の試合オブジェクト
 * @returns {string} - 変更点をまとめた短いテキスト
 */
function analyzeLineupChanges(teamName, dbMatch, state) { // ★引数に state を追加
    const teamRecord = state.teamRecords[teamName]; // ★渡された資料(state)を見るように変更
    if (!teamRecord || !teamRecord.previousStarters) {
        return "今大会初戦のため、比較なし。";
    }
    const teamKey = dbMatch.team1 === teamName ? 'team1' : 'team2';
    const previousStarters = teamRecord.previousStarters;
    const currentStarters = dbMatch.details.batting[teamKey].filter(p => p.order && !p.order.toString().includes('sub'));

    if (previousStarters.length === 0 || currentStarters.length === 0) return "比較データなし。";
    
    let changes = [];
    const prevPlayerMap = new Map(previousStarters.map(p => [p.name, p]));
    const currentPlayerMap = new Map(currentStarters.map(p => [p.name, p]));

    // 1. スタメンから外れた選手を検出
    for (const prevPlayer of previousStarters) {
        if (!currentPlayerMap.has(prevPlayer.name)) {
            changes.push(`${prevPlayer.order}番の${prevPlayer.name}がスタメン落ち`);
        }
    }

    // 2. 新しくスタメンに入った選手や、打順が変わった選手を検出
    for (const currPlayer of currentStarters) {
        const prevPlayer = prevPlayerMap.get(currPlayer.name);
        if (!prevPlayer) {
            changes.push(`${currPlayer.order}番に${currPlayer.name}が新しくスタメン入り`);
        } else {
            if (currPlayer.order !== prevPlayer.order) {
                changes.push(`${currPlayer.name}が${prevPlayer.order}番から${currPlayer.order}番に打順変更`);
            }
        }
    }
    
    if (changes.length === 0) {
        return "前試合からスタメン変更なし。";
    }
    
    // AIに渡す情報が多すぎないよう、主な変更点に絞る
    return `主な変更点: ${changes.slice(0, 3).join('、')}。`;
}

/**
 * トーナメント表をたどり、次の対戦相手の情報を特定する（★タイプミスを修正した最終版）
 * @param {string} teamName - チーム名
 * @param {string} currentMatchId - そのチームが勝利した現在の試合ID
 * @returns {object|null} - 次の対戦相手に関する詳細情報
 */
function findNextOpponent(teamName, currentMatchId) {
    const allMatches = state.matches;
    // ★★★ ここが修正箇所： allMessages -> allMatches に修正 ★★★
    if (!allMatches || !allMatches[currentMatchId]) return null;

    const idParts = currentMatchId.split('-');
    const side = idParts[0];

    if (side === 'F') {
        return { opponentName: '優勝', roundName: '大会終了' };
    }

    const roundNum = parseInt(idParts[1].slice(1));
    const matchNum = parseInt(idParts[2].slice(1));
    const numTeams = state.teams.length;
    const finalRound = Math.log2(numTeams);

    let nextMatchId, roundName;
    if (roundNum === finalRound - 1) {
        nextMatchId = 'F-R1-M1';
        roundName = '決勝';
    } else if (roundNum < finalRound - 1) {
        const nextRoundNum = roundNum + 1;
        nextMatchId = `${side}-R${nextRoundNum}-M${Math.ceil(matchNum / 2)}`;
        const roundNameMap = { [finalRound - 1]: "準決勝", [finalRound - 2]: "準々決勝" };
        roundName = roundNameMap[nextRoundNum] || `${nextRoundNum}回戦`;
    } else {
        return null;
    }

    const nextMatch = allMatches[nextMatchId];
    if (!nextMatch) return null;

    let opponentName = null;
    if (nextMatch.team1 && nextMatch.team1 !== teamName) opponentName = nextMatch.team1;
    else if (nextMatch.team2 && nextMatch.team2 !== teamName) opponentName = nextMatch.team2;

    if (opponentName) {
        return {
            opponentName: opponentName,
            opponentRank: calculateRank(opponentName, tournamentState),
            roundName: roundName
        };
    } else {
        // 相手が未定の場合、その相手を決める試合を探しに行く
        const feederMatchNumber = matchNum % 2 === 1 ? matchNum + 1 : matchNum - 1;
        const feederMatchId = `${side}-R${roundNum}-M${feederMatchNumber}`;
        const feederMatch = allMatches[feederMatchId];

        if (feederMatch && feederMatch.team1 && feederMatch.team2) {
            return {
                opponentName: '（未定）',
                roundName: roundName,
                decidingMatch: {
                    team1: feederMatch.team1,
                    rank1: calculateRank(feederMatch.team1, tournamentState),
                    team2: feederMatch.team2,
                    rank2: calculateRank(feederMatch.team2, tournamentState)
                }
            };
        }
        
        return { opponentName: '（未定）', opponentRank: '?', roundName: roundName };
    }
}
/**
 * チームの今大会の軌跡を要約する
 * (★試合ごとの記録を参照して、正確に猛打賞を判断する最終版)
 */
function getCurrentTournamentPerformance(teamName, currentMatchId) {
    const teamRecord = state.teamRecords[teamName];
    if (!teamRecord) return "今大会初戦。";

    const path = [];
    const keyPerformances = new Set();
    const currentTournamentMatchIds = Object.keys(state.matches);

    for (const matchId of currentTournamentMatchIds) {
        if (matchId === currentMatchId) continue;
        const match = tournamentState.matches[matchId];
        
        if (match.winner && (match.team1 === teamName || match.team2 === teamName)) {
            const opponent = match.team1 === teamName ? match.team2 : match.team1;
            const roundNum = match.id.includes('-R') ? parseInt(match.id.split('-')[1].slice(1)) : 1;
            
            if (match.winner === teamName) {
                path.push(`${roundNum}回戦 vs ${opponent}`);
            }

            if (match.details) {
                const teamKey = match.team1 === teamName ? 'team1' : 'team2';
                
                // 投手の好投
                const pitchers = match.details.pitching?.[teamKey] || [];
                pitchers.forEach(p => {
                    if (p.name && p.result === 'W' && parseFloat(p.innings) >= 6) {
                        keyPerformances.add(`${p.name}が${roundNum}回戦で好投`);
                    }
                });

                // 保存された「試合ごとの成績」を参照して猛打賞を判断
                if (match.details.playerGameStats) {
                    const gameStats = match.details.playerGameStats[teamKey];
                    for (const playerName in gameStats) {
                        // この試合で3安打以上打っていたかをチェック
                        if (gameStats[playerName].h >= 3) {
                            keyPerformances.add(`${playerName}が${roundNum}回戦で猛打賞を記録`);
                        }
                    }
                }
            }
        }
    }
    
    let summary = "";
    if (path.length === 0) {
        return "今大会初戦。";
    } else {
        summary += `ここまでの勝ち上がり: ${path.join(' → ')}。`;
    }
    
    // 大会通算打率の分析
    const playerBattingStats = teamRecord.playerStats?.batting || {};
    for (const playerName in playerBattingStats) {
        const stats = playerBattingStats[playerName];
        if (stats.ab >= 5) { // 5打数以上の選手を対象
            const battingAverage = stats.h / stats.ab;
            if (battingAverage >= 0.4) {
                keyPerformances.add(`${playerName}が打率4割超えと絶好調`);
            } else if (battingAverage <= 0.2) {
                keyPerformances.add(`${playerName}が打率2割以下と不振`);
            }
        }
    }
    
    if (keyPerformances.size > 0) {
        summary += `今大会の主な活躍: ${Array.from(keyPerformances).join('、')}。`;
    }

    return summary;
}

/**
 * 選手の大会通算成績を、AIプロンプト用の短い文章に要約する
 * @param {string} playerName - 選手名
 * @param {string} teamName - チーム名
 * @returns {string | null} - "姫川: 打率.500, 3本塁打, 10打点" のような要約文。成績がなければnull。
 */
function getPlayerTournamentStatsSummary(playerName, teamName) {
    const teamRecord = tournamentState.teamRecords[teamName];
    if (!teamRecord || !teamRecord.playerStats) return null;

    const battingStats = teamRecord.playerStats.batting[playerName];
    const pitchingStats = teamRecord.playerStats.pitching[playerName];
    
    let summaries = [];

    if (battingStats && battingStats.ab > 0) {
        const avg = (battingStats.h / battingStats.ab).toFixed(3);
        summaries.push(`打率${avg}, ${battingStats.hr}本塁打, ${battingStats.rbi}打点`);
    }

    if (pitchingStats && pitchingStats.ip > 0) {
        const era = pitchingStats.er > 0 ? ((pitchingStats.er * 9) / pitchingStats.ip).toFixed(2) : "0.00";
        summaries.push(`${pitchingStats.w}勝${pitchingStats.l}敗, 防御率${era}, ${pitchingStats.so}奪三振`);
    }

    if (summaries.length > 0) {
        return `${playerName}: ${summaries.join(' / ')}`;
    }
    
    return null;
}
/**
 * 試合の個人成績をAIプロンプト用のテキスト形式（★背番号付きボックススコア）にフォーマットする
 * @param {object} dbMatch - 試合オブジェクト
 * @returns {string} - フォーマットされたテキスト
 */
function formatPlayerStatsForPrompt(dbMatch) {
    if (!dbMatch || !dbMatch.details || !dbMatch.details.playerGameStats) {
        return '詳細な個人成績データはありません。';
    }

    const { details, winner } = dbMatch;

    const formatTeamStats = (teamKey) => {
        const teamName = dbMatch[teamKey];
        const isWinner = teamName === winner;
        const battingOrder = details.batting?.[teamKey] || [];
        const gameStats = details.playerGameStats?.[teamKey] || {};
        const pitchingData = details.pitching?.[teamKey] || [];

        let output = `\n**${teamName} (${isWinner ? '勝者' : '敗者'})**\n`;

        const sortedBatters = battingOrder.sort((a, b) => {
            const orderA = parseFloat(a.order.replace('-sub', '.'));
            const orderB = parseFloat(b.order.replace('-sub', '.'));
            return orderA - orderB;
        });

        sortedBatters.forEach(player => {
            if (!player.name) return;
            const stats = gameStats[player.name];
            if (!stats || !stats.played) return; 

            const orderDisplay = player.order.includes('sub') ? `  - ${player.sub_type || '代'}` : `${player.order}.`;
            // ★ここを変更: 選手名の前に背番号を追加
            const playerIdentifier = `[#${player.number}] ${player.name}`; 
            const statsLine = `${stats.ab}打数${stats.h}安打 ${stats.rbi}打点` + (stats.hr > 0 ? ` ${stats.hr}本塁打` : '');
            
            output += `${orderDisplay} ${playerIdentifier} (${player.pos}): ${statsLine}\n`;
        });
        
        pitchingData.forEach(pitcher => {
            if (!pitcher.name || !pitcher.innings) return;
            // ★ここも変更: 投手名の前に背番号を追加 (打撃データから背番号を検索)
            const pitcherData = sortedBatters.find(b => b.name === pitcher.name);
            const pitcherIdentifier = pitcherData ? `[#${pitcherData.number}] ${pitcher.name}` : pitcher.name;
            output += `- 投手: ${pitcherIdentifier} (${pitcher.innings}回 ${pitcher.runs}失点 ${pitcher.strikeouts}奪三振 ${pitcher.walks}四死球)\n`;
        });

        return output;
    };

    return formatTeamStats('team1') + formatTeamStats('team2');
}
/**
 * 全イニングの試合経過テキストを生成するマスター関数
 */
function generatePlayByPlayText(dbMatch) {
    if (!dbMatch || !dbMatch.details) return "詳細な試合データがありません。";

    let playByPlay = "";
    const numInnings = dbMatch.details.inningScore?.team1?.length || 9;
    // 各チームの次の先頭打者を記録するオブジェクト
    let batterIndices = { team1: 0, team2: 0 };

    for (let i = 0; i < numInnings; i++) {
        // 表の攻撃
        playByPlay += `\n【${i + 1}回表】${dbMatch.team1}の攻撃\n`;
        playByPlay += processHalfInning(dbMatch, 'team1', i, batterIndices);
        
        // サヨナラゲームの判定
        if (i >= 8) { // 9回表以降
            const score1 = (dbMatch.details.inningScore.team1 || []).slice(0, i + 1).reduce((a, b) => a + (b || 0), 0);
            const score2 = (dbMatch.details.inningScore.team2 || []).slice(0, i + 1).reduce((a, b) => a + (b || 0), 0);
            if (dbMatch.team2 === dbMatch.winner && score2 > score1) {
                 break;
            }
        }

        // 裏の攻撃
        playByPlay += `\n【${i + 1}回裏】${dbMatch.team2}の攻撃\n`;
        playByPlay += processHalfInning(dbMatch, 'team2', i, batterIndices);
    }

    playByPlay += "\n--- 試合終了 ---\n";
    return playByPlay;
}
/**
     * チームランク（A～E）から説明的な文字列を取得する
     */
    function getRankDescription(rank) {
        switch(rank) {
            case 'A': return '名門校';
            case 'B': return '強豪校';
            case 'C': return '中堅校';
            case 'D': return '発展途上のチーム';
            case 'E': return '挑戦者';
            default: return '実力不明';
        }
    }

 /**
     * リトライ機能付きでバックエンドAPI(Netlify Function)を呼び出す
     */
    async function fetchWithRetry(payload, maxRetries = 3) {
        const functionUrl = '/.netlify/functions/generateApiContent'; // Netlify Functionのエンドポイント
        let lastError;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(functionUrl, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    return response;
                }
                
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    const errorData = await response.json();
                    throw new Error(`API Error: ${errorData.error}`);
                }

                lastError = new Error(`API Error: ${response.status}`);
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));

            } catch (error) {
                lastError = error;
                const delay = Math.pow(2, i) * 1000;
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }
/**
     * AIからの応答テキストからJSONオブジェクトを安全に抽出する
     */
    function parseJsonFromText(text) {
        try {
            const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = cleanedText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error("Failed to parse JSON from text:", text, e);
        }
        return null;
    }
/**
 * 打席結果の文字列を、シミュレーションで使える日本語とデータに変換する
 */
function translatePlay(atBatString) {
    if (!atBatString) return { description: "記録なし", type: "none", out: false, base: 0 };
    
    const s = atBatString;
    if (s.includes('本塁打')) return { description: `ホームラン`, type: "hr", out: false, base: 4 };
    if (s.includes('三塁打')) return { description: `三塁打`, type: "triple", out: false, base: 3 };
    if (s.includes('二塁打')) return { description: `二塁打`, type: "double", out: false, base: 2 };
    if (s.includes('安')) return { description: `ヒット`, type: "single", out: false, base: 1 };
    
    if (s.includes('四球') || s.includes('死球')) return { description: `四死球`, type: "walk", out: false, base: 1 };
    if (s.includes('エラー') || s.includes('野選') || s.includes('犠失')) return { description: `エラー/野選`, type: "error", out: false, base: 1 };

    if (s.includes('犠飛')) return { description: `犠牲フライ`, type: "sac_fly", out: true, base: 0 };
    if (s.includes('犠打')) return { description: `犠牲バント`, type: "sac_bunt", out: true, base: 0 };
    if (s.includes('併殺')) return { description: `併殺打`, type: "dp", out: true, base: 0 }; // 2アウトは別途処理

    if (s.includes('三振')) return { description: `三振`, type: "so", out: true, base: 0 };
    if (s.includes('ゴロ')) return { description: `ゴロ`, type: "go", out: true, base: 0 };
    if (s.includes('飛')) return { description: `フライ`, type: "fo", out: true, base: 0 };
    if (s.includes('直')) return { description: `ライナー`, type: "lo", out: true, base: 0 };
    
    return { description: `その他`, type: "other", out: false, base: 0 };
}

/**
 * 1イニング分の試合経過をシミュレートし、テキストを生成する
 */
function processHalfInning(dbMatch, teamKey, inningIndex, batterIndices) {
    let halfInningText = "";
    let outs = 0;
    let bases = [null, null, null]; // [1B, 2B, 3B]
    
    const battingOrder = dbMatch.details.batting[teamKey].filter(p => p.name).sort((a,b) => a.order - b.order);
    if (battingOrder.length === 0) return "";
    
    let batterIndex = batterIndices[teamKey];
    let atBatsInInning = 0;

    while (outs < 3) {
        const batter = battingOrder[batterIndex];
        const resultString = batter.results[inningIndex] || "";
        const atBatsForPlayer = resultString.split('、');

        // このイニングでこの打者がまだ打席に立っていない場合はループを抜ける
        if (atBatsForPlayer.length <= atBatsInInning) break; 
        
        const currentAtBatString = atBatsForPlayer[atBatsInInning];
        if(!currentAtBatString) break;

        const play = translatePlay(currentAtBatString);
        
        // 1. 打席結果をテキストに追加
        halfInningText += `${batter.order}番 ${batter.name} (${batter.pos}): ${play.description}\n`;

        // 2. アウトカウントを更新
        if(play.out) outs++;
        if(play.type === 'dp') outs++; // 併殺打

        if (outs >= 3) {
            halfInningText += `  → ${outs}アウト\n`;
            batterIndex = (batterIndex + 1) % battingOrder.length;
            break;
        }
        
        // 3. ランナーを進塁させる（簡易ロジック）
        const newBases = [null, null, null];
        let batterOnBase = false;

        // まずランナーを進める (3塁から)
        if (bases[2]) { // 3塁ランナー
            if (play.base >= 1 || play.type === 'sac_fly' || play.type === 'walk') newBases[2] = null; // 生還
            else newBases[2] = bases[2];
        }
        if (bases[1]) { // 2塁ランナー
            if (play.base >= 2) newBases[1] = null; // 生還
            else if (play.base === 1 || play.type === 'sac_bunt') newBases[2] = bases[1];
            else newBases[1] = bases[1];
        }
        if (bases[0]) { // 1塁ランナー
            if (play.base >= 3) newBases[0] = null; // 生還
            else if (play.base === 2) newBases[2] = bases[0];
            else if (play.base === 1 || play.type === 'sac_bunt' || play.type === 'walk') newBases[1] = bases[0];
            else newBases[0] = bases[0];
        }
        
        // 打者走者を塁に出す
        if (!play.out && play.base > 0) {
            newBases[play.base - 1] = batter.name;
        }

        bases = newBases;
        
        // 4. 現在の状況をテキストに追加
        const runners = [];
        if(bases[0]) runners.push("1塁");
        if(bases[1]) runners.push("2塁");
        if(bases[2]) runners.push("3塁");
        const runnerText = runners.length > 0 ? `ランナー${runners.join(', ')}` : "ランナーなし";
        halfInningText += `  → ${outs}アウト, ${runnerText}\n`;
        
        batterIndex = (batterIndex + 1) % battingOrder.length;
        atBatsInInning++;
    }

    batterIndices[teamKey] = batterIndex; // 次のイニングの先頭打者を記憶
    
    if (outs < 3) {
      halfInningText += `(${outs}アウトでイニング終了)\n`;
    }
    
    halfInningText += "チェンジ\n";
    return halfInningText;
}
/**
 * 戦績レコードを読みやすい文字列に変換する
 */
function formatRecordToString(record) {
    if (!record) return "データなし";
    const year = record.year.toString().slice(-2);
    const tournamentNameMap = { summer: '夏', autumn: '秋', spring: '春' };
    const tournament = tournamentNameMap[record.tournament] || '';
    const rank = getRankString(record.rank);
    // ★★★ 以下の行を変更 ★★★
    const prefix = record.rank < 0 ? '' : '県大会'; // 甲子園成績の場合は「県大会」をつけない
    return `'${year} ${tournament}: ${prefix}${rank}`;
    // ★★★ ここまで変更 ★★★
}
/**
     * 試合IDを元に、stateオブジェクトの深い階層から試合オブジェクトを検索して返す
     */
    
    function findMatchById(matchId, state) { // ★引数に state を追加
    // 通常のトーナメント表を検索
    if (state.matches && state.matches[matchId]) { // ★state を参照するように変更
        return state.matches[matchId];
    }
    // 秋季大会の地区予選・順位決定戦を検索
    if (tournamentState.autumnData) {
        for (const region of ['東部', '中部', '西部', '伊豆']) { // 伊豆を追加
            const regionData = tournamentState.autumnData.regions[region];
            if (!regionData) continue;
            // ▼▼▼ このブロックが修正箇所 ▼▼▼
            if (regionData.blocks) { // 東部・中部・西部
                for (const block of regionData.blocks) {
                    if (block.matches[matchId]) return block.matches[matchId];
                }
            }
            if (regionData.izuBracket && regionData.izuBracket.matches[matchId]) { // 伊豆
                return regionData.izuBracket.matches[matchId];
            }
            // ▲▲▲
            if (regionData.champBracket && regionData.champBracket.matches[matchId]) {
                return regionData.champBracket.matches[matchId];
            }
            if (regionData.repechageBracket && regionData.repechageBracket.matches[matchId]) {
                return regionData.repechageBracket.matches[matchId];
            }
        }
    }
        
        // 春季大会の地区予選を検索
         if (state.springData) {
        for (const region of ['東部', '中部', '西部', '伊豆']) {
            const regionData = tournamentState.springData.regions[region];
            if (!regionData) continue;

            // ブロック代表決定戦を検索
            if (regionData.blocks) {
                for (const block of regionData.blocks) {
                    if (block.matches[matchId]) return block.matches[matchId];
                }
            }
            // 第5代表決定戦（敗者復活）を検索
            if (regionData.repechageBracket && regionData.repechageBracket.matches[matchId]) {
                return regionData.repechageBracket.matches[matchId];
            }
            // 伊豆地区予選を検索
            if (regionData.izuBracket && regionData.izuBracket.matches[matchId]) {
                return regionData.izuBracket.matches[matchId];
            }
        }
    }
    // ▲▲▲ ここまで修正 ▲▲▲
        return null; // どこにも見つからなかった場合
    }

/**
     * AIプロンプト用に、現在の大会状況の要約を生成する
     */
    function getTournamentStatusSummary() {
        if (state.currentTournament === 'autumn') {
            return `現在、${tournamentState.tournamentYear}年度 秋季大会が進行中です。フェーズ: ${tournamentState.autumnPhase}`;
        }
        
        const finalMatch = tournamentState.matches['F-R1-M1'];
        if (finalMatch?.winner) return `${finalMatch.winner}が優勝しました。`;
        if (finalMatch?.team1 && finalMatch.team2) return `決勝戦の組み合わせは ${finalMatch.team1} vs ${finalMatch.team2} です。`;
        
        const numRounds = Math.log2(tournamentState.teams.length);
        for (let r = numRounds - 1; r >= 1; r--) {
            const roundIds = Object.keys(tournamentState.matches).filter(id => id.includes(`-R${r}-`));
            if (roundIds.some(id => tournamentState.matches[id]?.team1 && tournamentState.matches[id]?.team2)) {
                 const roundNameMap = { 5: "準決勝", 4: "準々決勝", 3: "3回戦", 2: "2回戦", 1: "1回戦"};
                 return `現在、${roundNameMap[r] || r + '回戦'}が進行中です。`;
            }
        }
        return '大会はまもなく開始されます。';
    }

/**
 * Finds a specific team's final result in the tournament.
 */
function getTeamFateSummary(teamName) {
    const allMatches = { 
        ...tournamentState.matches, 
        ...(tournamentState.autumnData?.allMatches || {}),
        ...(tournamentState.springData?.allMatches || {}) 
    };

    for (const matchId in allMatches) {
        const match = allMatches[matchId];
        if (match.winner && (match.team1 === teamName || match.team2 === teamName)) {
            if (match.winner !== teamName) {
                const opponent = match.winner;
                const score1 = match.team1 === teamName ? match.score1 : match.score2;
                const score2 = match.team1 === teamName ? match.score2 : match.score1;
                const roundNum = match.id.includes('-R') ? parseInt(match.id.split('-')[1].slice(1)) : 1;
                return `${roundNum}回戦で${opponent}に${score1}-${score2}で敗退した。`;
            }
        }
    }
    
    // Check if the team is still in the tournament
    const isStillIn = Object.values(allMatches).some(match => !match.winner && (match.team1 === teamName || match.team2 === teamName));
    if(isStillIn) {
        return "まだ勝ち残っている。";
    }

    return "（今大会には出場していないか、情報がありません）";
}
   
/**
     * IDを元に、入れ子構造のコメントデータから特定のコメントを見つけ出す
     */
    function findCommentById(comments, id) {
        for (const comment of comments) {
            if (comment.id === id) return comment;
            if (comment.replies && comment.replies.length > 0) {
                const found = findCommentById(comment.replies, id);
                if (found) return found;
            }
        }
        return null;
    }

/**
     * AIプロンプト用に、掲示板の会話履歴をフォーマットする
     */
    function formatConversationHistory(comments, targetId) {
        let history = [];
        function findPath(currentComments, currentPath) {
            for(const comment of currentComments) {
                const newPath = [...currentPath, comment];
                if(comment.id === targetId) {
                    history = newPath;
                    return true;
                }
                if(comment.replies && findPath(comment.replies, newPath)) {
                    return true;
                }
            }
            return false;
        }
        findPath(comments, []);
        return history.map(c => `${c.personality}:「${c.text}」`).join('\n');
    }

export default async (req) => {
    onst { jobId, generationType, context } = await req.json();
    const blobs = getBlobs("ai-results");

    try {
        let result;
        
        // ★★★ バックエンド側で、完全な matchContext を作成 ★★★
        const fullContext = createMatchContext(context.matchId, context.winnerName, context.state);
    
        if (generationType === 'article') {
            result = await generateNewsArticle(context);
        } else if (generationType === 'bbs') {
            result = await generateBbsComments(context);
        } else if (generationType === 'game_bbs') {
            result = await generateGameMatchBbsComments(context);
        } else if (generationType === 'real_news_bbs') {
            result = await generateRealNewsBbsComments(context.headline, context.category);
        } 
        // ★★★ この else if ブロックを追記 ★★★
        else if (generationType === 'documentary') {
            const { phase, type, teamName, matchData, userFeedback } = context;
            result = await generateDocumentaryArticle(phase, type, teamName, matchData, userFeedback);
        } 
        // ★★★ 追記はここまで ★★★
        else {
            throw new Error(`不明な生成タイプです: ${generationType}`);
        }

        await blobs.setJSON(jobId, { status: "completed", data: result });

    } catch (error) {
        console.error("バックグラウンドでの生成に失敗:", error);
        await blobs.setJSON(jobId, { status: "failed", error: error.message });
    }
};
