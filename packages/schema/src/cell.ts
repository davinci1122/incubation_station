/**
 * Sheets に文字列として書き込む値のエスケープ。
 * = + - @ やタブ・改行で始まる値は数式として解釈され得るため、先頭に ' を付ける。
 * CSV 出力時にも同じ関数を通す。
 */
const FORMULA_LEAD = /^[=+\-@\t\r\n]/;

export function escapeCell(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}
