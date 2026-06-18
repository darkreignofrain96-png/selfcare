# 🩺 LINEセルフケア自動返信ツール セットアップマニュアル

このツールは、LINE公式アカウントでユーザーが疾患名やケア項目を選択（または自由入力）した際、Googleスプレッドシートから適切なセルフケア情報（リハビリ/食事などのテキストやYouTube動画リンク）を自動返信するシステムです。

---

## 📋 必要なアカウントとAPIキーの準備

本システムを稼働させるには、以下の準備が必要です。

### 1. Googleスプレッドシートの準備
1. Googleドライブ等で新規にスプレッドシートを作成します。
2. シート名を `Sheet1` とし、1行目に以下のヘッダー（カラム名）を作成します（カラムの順序は固定です）。
   - A列: `category` （例：腰痛、肩こり）
   - B列: `type` （例：リハビリ、食事）
   - C列: `text` （返信するテキストメッセージの内容）
   - D列: `video_url` （YouTubeの動画URLなど ※空欄でも可）
   - E列: `keywords` （AI検索時に引っ掛かりやすくする同義語などのキーワードをカンマ区切りで入力 ※空欄でも可）
3. ブラウザのアドレスバーからスプレッドシートのIDを取得します。
   `https://docs.google.com/spreadsheets/d/[スプレッドシートID]/edit#gid=0`

### 2. Google Cloud（Sheets API）の設定
スプレッドシートのデータをプログラムから読み込むための認証情報を作成します。
1. **Google Cloud Console** (https://console.cloud.google.com/) にアクセスします。
2. 新しいプロジェクトを作成、または既存のプロジェクトを選択します。
3. APIライブラリで「**Google Sheets API**」を検索し、**有効化**します。
4. 「認証情報」タブに移動し、「**認証情報を作成**」 > 「**サービスアカウント**」を選択します。
5. サービスアカウント名（例: `selfcare-sheets-api`）を入力し、作成します（ロールの付与は不要で進めてOKです）。
6. 作成されたサービスアカウントのメールアドレス（例: `xxx@xxx.iam.gserviceaccount.com`）をコピーします。
7. 作成したサービスアカウントの詳細画面に入り、「**キー**」タブ > 「**鍵を追加**」 > 「**新しい鍵を作成**」を選択し、**JSON** 形式でダウンロードします。
   - ダウンロードしたJSONファイルの中身にある `client_email` と `private_key` が後ほど環境変数として必要になります。
8. **スプレッドシートの共有設定**: 
   作成したスプレッドシートの右上にある「共有」ボタンを押し、上記でコピーした**サービスアカウントのメールアドレス**を追加し、**閲覧者（または編集者）**として権限を付与します。

### 3. Gemini API キーの取得
自由記述のメッセージから意図を解析するためのAIキーを取得します。
1. **Google AI Studio** (https://aistudio.google.com/) にアクセスし、Googleアカウントでログインします。
2. 「**Get API key**」ボタンを押し、新規にAPIキーを作成します。
3. 発行されたキー（`AIzaSy...`）をコピーしておきます。

### 4. LINE Developers（Messaging API）の設定
1. **LINE Developers** (https://developers.line.biz/) にアクセスし、ビジネスアカウントでログインします。
2. プロバイダーを作成し、「**Messaging API**」チャネルを新規作成（または既存の公式アカウントに連携）します。
3. チャネルの設定画面から以下の2つを取得します。
   - **Channel Secret**（「チャネル基本設定」タブにあります）
   - **Channel Access Token**（「Messaging API」タブの一番下にスクロールし、「発行」ボタンを押すと生成されます）
4. 同タブの「**Webhook設定**」および「応答メッセージ」の設定：
   - 「Webhookの利用」を **オン** にします。
   - LINE Official Account Manager側の設定で「応答メッセージ」を **オフ** にします（オフにしないと、LINE既定の自動応答とシステムからの自動応答が重複してしまいます）。

---

## 🚀 Vercel へのデプロイ手順

このプログラムは無料枠で動かせるホスティングサービス **Vercel** にデプロイして動かします。

1. **Vercelアカウントの作成**: https://vercel.com/ でアカウントを作成します（GitHubアカウントと連携すると簡単です）。
2. **プロジェクトのアップロード**: 
   本プログラムのディレクトリをGitHub等のリポジトリにプッシュし、Vercelの管理画面からプロジェクトをインポートします。
3. **環境変数 (Environment Variables) の登録**:
   Vercelのプロジェクト設定（Settings > Environment Variables）で、以下の環境変数を登録します。

| 変数名 | 説明 | 例 / 取得元 |
| :--- | :--- | :--- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging APIのアックストークン | LINE Developersから取得 |
| `LINE_CHANNEL_SECRET` | LINEのチャネルシークレット | LINE Developersから取得 |
| `SPREADSHEET_ID` | スプレッドシートのID | スプレッドシートURLから抽出 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Googleサービスアカウントのメール | JSON内の `client_email` |
| `GOOGLE_PRIVATE_KEY` | Googleサービスアカウントの秘密鍵 | JSON内の `private_key` （改行コード `\n` もそのままコピーしてください） |
| `GEMINI_API_KEY` | Gemini APIのキー | Google AI Studioから取得 |

4. **デプロイ**:
   デプロイを実行します。完了すると、`https://[プロジェクト名].vercel.app` のようなURLが発行されます。
5. **Webhookの紐付け**:
   LINE Developersの「Messaging API」タブにある **Webhook URL** に、デプロイされたURLに `/api/webhook` を付加したアドレスを設定します。
   - 例: `https://[プロジェクト名].vercel.app/api/webhook`
   - 「検証」ボタンを押し、正しく疎通（Success）することを確認します。

---

## 🎨 LINE リッチメニューの設定

LINE公式アカウントの管理画面（LINE Official Account Manager）から、リッチメニューを作成します。
1. 「セルフケア」などをアピールする画像を作成し、メニューに設定します。
2. アクション設定で、ボタンを押した際に以下の「テキスト」を送信するよう設定します。
   - アクションタイプ: **テキスト**
   - 送信するテキスト: **`セルフケアを聞く`**

これにより、ユーザーがメニューのボタンを押すと自動的にチャット上に「セルフケアを聞く」というメッセージが送信され、自動応答フロー（疾患選択のボタン表示）が開始されます。
