# apps/gas

Google Sheets を正とするデータAPI（Google Apps Script）。スプレッドシートに紐づくスクリプトとして動かします。

- `src/` … 本体。番号順に連結して1ファイルにします（ビルド不要のプレーンなJavaScript）。
- `dist/Code.gs` … 連結済み。Apps Script エディタに貼り付ける用。`node apps/gas/build.mjs` で更新。
- `test/` … Apps Script のサービスをまねた環境で動かすテスト。

## 導入

1. スプレッドシートで「拡張機能 → Apps Script」を開く。
2. `コード.gs` の中身を `dist/Code.gs` の内容で置き換えて保存する。
3. エディタ上部の関数名で `setup` を選び「実行」する（権限の承認が出たら許可）。
4. コードを更新したときは「デプロイを管理」から新バージョンをデプロイする。

## Script Properties

| キー | 内容 |
| --- | --- |
| `ALLOWED_EMAIL` | 利用を許可する Google アカウント。初期セットアップ時に実行者のアドレスが入る |
| `OAUTH_CLIENT_ID` | ウェブアプリのログインに使う OAuth クライアントID |
| `AI_API_KEY` | （任意）AIでの一括整理に使う Gemini API キー。未設定なら機能は無効 |
| `SCREENSHOT_SERVICE` | （任意）`off` にすると、画像のないページのスクリーンショット取得を止める |

値はリポジトリに書かないでください。

## 自動反映

`main` に `apps/gas` の変更が入ると、GitHub Actions（`deploy-gas.yml`）がテスト後に Apps Script へ反映し、
既存のウェブアプリを新バージョンに更新します。Secrets に `CLASP_TOKEN`（`~/.clasprc.json` の中身）が必要です。反映先のスクリプトIDはワークフローに記載しています。

権限（`appsscript.json` の `oauthScopes`）を変えた場合だけ、エディタで `setup` を1回実行して承認し直してください。

## AIでの整理と保守

- メニュー「Cabinet → AIで整理」は、実行前に対象件数・見積もりトークン数・予想費用・今月の累計を表示します。
  モデル名・単価・為替・月の上限は `_meta` シートの `ai_*` の行で変更できます。
- 毎日4時ごろに `dailyMaintenance` が動き、削除から30日を過ぎたアイテムを消し、バックアップを取ります。
  バックアップは曜日ごとの7ファイルを上書きで使い回し、月初にその月の控えを1つ作ります。
