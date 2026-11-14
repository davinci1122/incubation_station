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
| `OAUTH_CLIENT_ID` | ウェブアプリのログインに使う OAuth クライアントID（P2で設定） |

値はリポジトリに書かないでください。
