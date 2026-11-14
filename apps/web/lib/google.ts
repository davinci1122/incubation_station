import { GOOGLE_CLIENT_ID } from "./config";

type CredentialResponse = { credential?: string };
type GoogleId = {
  initialize(options: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(element: HTMLElement, options: Record<string, string | number>): void;
  prompt(): void;
  disableAutoSelect(): void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const KEY = "cabinet:id_token";
const listeners = new Set<() => void>();
let token: string | null = null;
let loading: Promise<GoogleId> | null = null;

/** 保存してあるIDトークン。期限切れかどうかは、送信時にサーバーが判断する（切れていれば renewToken で取り直す）。 */
export function getToken(): string | null {
  if (token === null && typeof window !== "undefined") {
    try {
      token = window.localStorage.getItem(KEY);
    } catch {
      token = null;
    }
  }
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    // 保存できなくてもメモリ上の値で動く
  }
  listeners.forEach((fn) => fn());
}

export function subscribeToken(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadGoogle(): Promise<GoogleId> {
  if (loading) return loading;
  loading = new Promise<GoogleId>((resolve, reject) => {
    const ready = () => {
      const id = window.google?.accounts.id;
      if (!id) return reject(new Error("Googleログインを読み込めませんでした。"));
      id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: true,
        use_fedcm_for_prompt: true,
        callback: (response) => {
          if (response.credential) setToken(response.credential);
        },
      });
      resolve(id);
    };
    if (window.google?.accounts.id) return ready();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      loading = null;
      reject(new Error("Googleログインを読み込めませんでした。通信状況を確認してください。"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

let renewing: Promise<boolean> | null = null;

/**
 * 期限切れなどのとき、Googleに確認して新しいIDトークンを取る。
 * ブラウザが許せば画面を出さずに済む。取れなければ false（そのときはログイン画面になる）。
 */
export function renewToken(): Promise<boolean> {
  if (renewing) return renewing;
  renewing = (async () => {
    try {
      const id = await loadGoogle();
      return await new Promise<boolean>((resolve) => {
        let unsubscribe = (): void => {};
        const timer = window.setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, 8000);
        unsubscribe = subscribeToken(() => {
          if (getToken()) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve(true);
          }
        });
        id.prompt();
      });
    } catch {
      return false;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

export async function signOut(): Promise<void> {
  try {
    (await loadGoogle()).disableAutoSelect();
  } catch {
    // 読み込めなくてもトークンは破棄する
  }
  setToken(null);
}
