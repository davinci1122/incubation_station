# INTERNET CABINET

A personal archive of the web. — 個人専用のWebアーカイブ。

Webサイト・記事・画像・PDFを、保存時点の状態ごと収集・整理・再発見するためのアプリです。

## 構成

| 場所 | 役割 |
| --- | --- |
| `apps/web` | Next.js（静的エクスポート）。GitHub Pages で配信するPWA |
| `apps/gas` | Google Apps Script。Google Sheets を正とするデータAPI（P1で実装） |
| `apps/worker` | Cloud Run のキャプチャWorker。Playwright で各形式を取得（P3で実装） |
| `packages/schema` | テーブル定義（Sheets の列）とエラーコード |
| `packages/url` | URL正規化とSSRF判定 |

データは Google Sheets、ファイルは Google Drive に置き、ブラウザは Google ログインのトークンで直接アクセスします。アプリ側に秘密情報は持ちません。

## 開発

```
pnpm install
pnpm test        # packages のテスト（Node 22 の node:test）
pnpm typecheck
pnpm dev         # apps/web
```

## 秘密情報

- 秘密情報、スプレッドシートID、フォルダID、メールアドレスはコミットしません。
- 値は各実行環境（Script Properties / Secret Manager / GitHub Variables）に設定します。キー名は `.env.example` を参照。
- CI で gitleaks を実行しています。
