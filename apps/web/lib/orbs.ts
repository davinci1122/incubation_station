// ぼかした球の配置を、文字列（アイテムIDなど）から毎回同じ結果になるように決める。
const RECIPES = [
  "radial-gradient(circle, #5B6CFF 0%, #5B6CFF 16%, #E4476B 40%, #F4B24A 64%, rgba(244,178,74,0) 71%)",
  "radial-gradient(circle, #B9D94A 0%, #B9D94A 42%, #F2B84B 64%, rgba(242,184,75,0) 71%)",
  "radial-gradient(circle, #3D8FD9 0%, #3D8FD9 30%, #9ED4FF 52%, #F6C6F2 66%, rgba(246,198,242,0) 71%)",
  "radial-gradient(circle, #0E2A2E 0%, #0E2A2E 38%, #2BB6C9 52%, #FF5A5F 63%, rgba(255,90,95,0) 71%)",
  "radial-gradient(circle, #8E0F3C 0%, #8E0F3C 34%, #D94A6A 56%, #F7C3CC 66%, rgba(247,195,204,0) 71%)",
  "radial-gradient(circle, #7FF0B8 0%, #7FF0B8 30%, #C9FBE3 58%, rgba(201,251,227,0) 71%)",
  "radial-gradient(circle, #F3A6E8 0%, #8FB4FF 28%, #8FB4FF 48%, #F3A6E8 64%, rgba(243,166,232,0) 71%)",
] as const;

export type Orb = { background: string; size: number; left: number; top: number; blur: number };

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 0 以上 1 未満の乱数列（mulberry32）。 */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function orbsFor(seed: string, count = 4, scale = 1): Orb[] {
  const next = random(hash(seed));
  return Array.from({ length: count }, () => {
    const size = Math.round((80 + next() * 90) * scale);
    return {
      background: RECIPES[Math.floor(next() * RECIPES.length)] ?? RECIPES[0],
      size,
      left: Math.round(-12 + next() * 80),
      top: Math.round(-14 + next() * 76),
      blur: Math.max(6, Math.round(size * 0.09)),
    };
  });
}

/** 画像のないカードの高さ（px）。シードごとに一定。 */
export function heightFor(seed: string): number {
  return 150 + (hash(seed) % 110);
}
