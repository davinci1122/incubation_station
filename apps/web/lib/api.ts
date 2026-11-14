import { GAS_URL } from "./config";
import { getToken, setToken } from "./google";

export class ApiError extends Error {
  code: string;
  extra: unknown;
  constructor(code: string, message: string, extra?: unknown) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; extra?: unknown } };

/** GAS のデータAPIを呼ぶ。プリフライトを避けるため text/plain で送る。 */
export async function call<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const idToken = getToken();
  if (!idToken) throw new ApiError("UNAUTHENTICATED", "ログインが必要です。");
  let response: Response;
  try {
    response = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ id_token: idToken, action, params }),
      redirect: "follow",
    });
  } catch {
    throw new ApiError("NETWORK", "通信できませんでした。接続を確認してください。");
  }
  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError("NETWORK", "サーバーから正しい応答がありませんでした。");
  }
  if (!body.ok) {
    if (body.error.code === "UNAUTHENTICATED") setToken(null);
    throw new ApiError(body.error.code, body.error.message, body.error.extra);
  }
  return body.data;
}
