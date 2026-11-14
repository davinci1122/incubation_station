// どちらも公開前提の値（ビルド後のJavaScriptに含まれ、誰でも見られる）。
// 秘密情報・スプレッドシートID・メールアドレスはここに書かない。
export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ||
  "662935820835-fuclp6on5bbk2obsnksa4m2q8c5cbl4v.apps.googleusercontent.com";

export const GAS_URL =
  process.env.NEXT_PUBLIC_GAS_URL ||
  "https://script.google.com/macros/s/AKfycbwWPn0aLjpncvus3WITf1OouwQ6aZCHlmliWwmcjT8xA4cQweXOEFfMZsnnXV9VALYu/exec";
