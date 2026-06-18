const { Client, middleware } = require('@line/bot-sdk');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/generative-ai');
const querystring = require('querystring');

// 環境変数の読み込み（ローカル開発用）
require('dotenv').config();

// LINE SDK 設定
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// クライアント初期化
const lineClient = new Client(lineConfig);

// Google Sheets API 初期化
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const RANGE_NAME = 'Sheet1!A2:E'; // ヘッダーを除いたA2〜E列

// ナレッジの全データを取得する関数
async function fetchKnowledgeData() {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE_NAME,
    });
    const rows = response.data.values || [];
    
    // カラム定義: A:category, B:type, C:text, D:video_url, E:keywords
    return rows.map(row => ({
      category: row[0] ? row[0].trim() : '',
      type: row[1] ? row[1].trim() : '',
      text: row[2] ? row[2].trim() : '',
      video_url: row[3] ? row[3].trim() : '',
      keywords: row[4] ? row[4].trim() : '',
    })).filter(item => item.category && item.type);
  } catch (error) {
    console.error('Error fetching data from Google Sheet:', error);
    return [];
  }
}

// Gemini API を使ってユーザーメッセージから疾患名とケア種別を特定する関数
async function analyzeMessageWithGemini(userMessage, categories, types) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not defined. Skipping AI analysis.');
    return { disease: null, type: null };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
ユーザーの質問: "${userMessage}"

以下の疾患リストとケア種別リストの中から、ユーザーが何について知りたいかを判定し、指定のJSON形式で回答してください。

【疾患リスト】
${categories.join(', ')}

【ケア種別リスト】
${types.join(', ')}

【ルール】
1. ユーザーの入力内容が、疾患リストのいずれかに強い関連性（表記揺れや同義語含む）があれば、その疾患名を "disease" に指定してください。全く関連がない場合は null にしてください。
2. ケア種別（リハビリ、食事など）が推測できる場合は "type" に指定してください。不明な場合は null にしてください。
3. 出力は純粋なJSONのみとし、\`\`\`json などのマークダウン装飾や解説文は一切含めないでください。

【回答フォーマット】
{
  "disease": "判定された疾患名またはnull",
  "type": "判定されたケア種別またはnull"
}
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      }
    });

    const responseText = result.response.text();
    console.log('Gemini raw response:', responseText);
    return JSON.parse(responseText.trim());
  } catch (error) {
    console.error('Error with Gemini API:', error);
    return { disease: null, type: null };
  }
}

// 疾患選択クイックリプライの生成
function createDiseaseQuickReply(categories) {
  const items = categories.map(cat => ({
    type: 'action',
    action: {
      type: 'postback',
      label: cat,
      data: querystring.stringify({ action: 'select_disease', disease: cat }),
      displayText: cat
    }
  }));

  return {
    type: 'text',
    text: 'どんな疾患を言われましたか？以下から選択してください。',
    quickReply: { items }
  };
}

// ケア種別選択クイックリプライの生成
function createTypeQuickReply(disease, types) {
  const items = types.map(t => ({
    type: 'action',
    action: {
      type: 'postback',
      label: t,
      data: querystring.stringify({ action: 'select_type', disease, type: t }),
      displayText: t
    }
  }));

  return {
    type: 'text',
    text: `${disease}ですね。どんなセルフケアを知りたいですか？`,
    quickReply: { items }
  };
}

// Vercel Serverless Function エントリーポイント
module.exports = async (req, res) => {
  // GETリクエストの場合はヘルスチェックとして200を返す
  if (req.method === 'GET') {
    return res.status(200).send('LINE Bot Webhook is running.');
  }

  // LINE署名の検証（ミドルウェアの直接呼び出し）
  // Vercel環境で動かすための署名検証ハンドラ
  const signature = req.headers['x-line-signature'];
  if (!signature) {
    return res.status(401).send('Unauthorized');
  }

  try {
    // Webhookイベントのパース
    const events = req.body.events;
    if (!events) {
      return res.status(200).send('OK');
    }

    // 各イベントの処理
    const results = await Promise.all(events.map(handleEvent));
    return res.status(200).json(results);
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send('Internal Server Error');
  }
};

// LINEイベントハンドラ
async function handleEvent(event) {
  if (event.type !== 'message' && event.type !== 'postback') {
    return null;
  }

  // ナレッジデータのロード
  const knowledge = await fetchKnowledgeData();
  if (knowledge.length === 0) {
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '現在、システムメンテナンス中のためセルフケアデータを読み込めません。しばらく経ってから再度お試しください。'
    });
  }

  // 登録されているユニークな疾患名とケア種別のリスト
  const categories = [...new Set(knowledge.map(item => item.category))];
  const allTypes = [...new Set(knowledge.map(item => item.type))];

  // 1. テキストメッセージを受信した場合
  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();

    // 「セルフケアを聞く」の場合：疾患選択のクイックリプライを返す
    if (userText === 'セルフケアを聞く') {
      return lineClient.replyMessage(event.replyToken, createDiseaseQuickReply(categories));
    }

    // 自由入力の場合：Gemini API で疾患とケア種別を解析する
    const aiResult = await analyzeMessageWithGemini(userText, categories, allTypes);
    const { disease, type } = aiResult;

    if (disease && type) {
      // 疾患とケア種別の両方が特定できた場合
      const match = knowledge.find(item => item.category === disease && item.type === type);
      if (match) {
        return sendCareInfo(event.replyToken, match);
      }
    } else if (disease) {
      // 疾患だけが特定できた場合、その疾患に紐づくケア種別を取得してクイックリプライ
      const availableTypes = [...new Set(knowledge.filter(item => item.category === disease).map(item => item.type))];
      return lineClient.replyMessage(event.replyToken, createTypeQuickReply(disease, availableTypes));
    }

    // 判定できなかった場合
    return lineClient.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: `「${userText}」に関連する情報が見つかりませんでした。以下の選択肢から選んでいただくか、別の表現で入力してください。`
      },
      createDiseaseQuickReply(categories)
    ]);
  }

  // 2. ポストバックイベントを受信した場合（ボタンタップ）
  if (event.type === 'postback') {
    const data = querystring.parse(event.postback.data);

    if (data.action === 'select_disease') {
      const disease = data.disease;
      const availableTypes = [...new Set(knowledge.filter(item => item.category === disease).map(item => item.type))];
      return lineClient.replyMessage(event.replyToken, createTypeQuickReply(disease, availableTypes));
    }

    if (data.action === 'select_type') {
      const { disease, type } = data;
      const match = knowledge.find(item => item.category === disease && item.type === type);
      if (match) {
        return sendCareInfo(event.replyToken, match);
      } else {
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '申し訳ありません。該当するセルフケア情報が見つかりませんでした。'
        });
      }
    }
  }

  return null;
}

// セルフケア情報を送信するヘルパー関数
function sendCareInfo(replyToken, match) {
  const messages = [];

  // 1. テキスト情報の追加
  let responseText = `【${match.category}の${match.type}ケア】\n\n${match.text}`;
  
  // YouTube動画URLがある場合はテキストの末尾に付与する（動画リンクをテキストで送るだけでよいという要望に対応）
  if (match.video_url) {
    responseText += `\n\n🎬こちらの動画も参考にしてください：\n${match.video_url}`;
  }

  messages.push({
    type: 'text',
    text: responseText
  });

  return lineClient.replyMessage(replyToken, messages);
}
