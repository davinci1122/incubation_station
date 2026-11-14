import { call } from "./api";
import { upsert, type Row } from "./store";

const MAX_SIDE = 1200;
/** 送信する上限（base64の文字数）。GAS側の上限より少し小さくしておく。 */
const MAX_BASE64 = 2_400_000;

/** 長辺を MAX_SIDE に縮小し、JPEG にして base64 で返す。容量を抑えるため。 */
async function toPayload(file: Blob): Promise<{ data: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした。"))), "image/jpeg", 0.86),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), mime: "image/jpeg" };
}

/** 画像を選んで（またはペーストして）アイテムの画像にする。オンラインのときだけ動く。 */
export async function uploadItemImage(id: string, file: Blob): Promise<void> {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選んでください。");
  const payload = await toPayload(file);
  if (payload.data.length > MAX_BASE64) throw new Error("画像が大きすぎます。");
  const res = await call<{ item: Row }>("items.setImage", { id, ...payload });
  upsert({ items: [res.item] });
}
