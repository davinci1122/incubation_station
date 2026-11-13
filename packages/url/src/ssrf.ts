/**
 * SSRF対策の判定。取得してはいけない宛先（ループバック・プライベート・
 * リンクローカル・メタデータサーバー等）を拒否する。
 *
 * 注意: ホスト名の検査は入口の一次判定にすぎない。Worker では必ず
 * DNS解決後のIPに対して isBlockedIp を適用し、リダイレクトの各段と
 * ブラウザの全サブリクエストにも同じ検査を行うこと。
 */

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function isBlockedIpv4(o: number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** IPv6 文字列を 8 個の 16bit 値に展開する。不正なら null。 */
function parseIpv6(input: string): number[] | null {
  let host = input;
  const zone = host.indexOf("%");
  if (zone !== -1) host = host.slice(0, zone);
  if (!host.includes(":")) return null;

  // 末尾の IPv4 表記（::ffff:1.2.3.4）を 2 グループに変換
  const lastColon = host.lastIndexOf(":");
  const tail = host.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    host = `${host.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string): number[] | null => {
    if (s === "") return [];
    const groups: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function isBlockedIpv6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeroPrefix && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: / ::1
  if (zeroPrefix && g5 === 0xffff) return isBlockedIpv4(embedded); // IPv4-mapped
  if (zeroPrefix && g5 === 0) return isBlockedIpv4(embedded); // IPv4-compatible (deprecated)
  if (g0 === 0x64 && g1 === 0xff9b) return isBlockedIpv4(embedded); // NAT64
  if (g0 === 0x2002) return isBlockedIpv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

/** IPアドレス文字列が取得禁止の範囲なら true。IPとして解釈できない場合も true（安全側）。 */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6) return isBlockedIpv6(v6);
  return true;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal"]);

/**
 * URL のホスト名に対する一次判定。取得してはいけないなら true。
 * 10進・16進・8進などの数値表記は WHATWG URL がドット区切りIPv4に正規化するため、
 * 必ず `new URL(...).hostname` を渡すこと。
 */
export function isBlockedHostname(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "") return true;
  if (host.startsWith("[") && host.endsWith("]")) return isBlockedIp(host.slice(1, -1));
  if (parseIpv4(host)) return isBlockedIp(host);
  if (/^[\d.]+$/.test(host)) return true; // IPv4 らしいが解釈できない表記
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (!host.includes(".")) return true; // 単一ラベルは内部名とみなす
  return false;
}
