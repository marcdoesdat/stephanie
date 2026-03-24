/**
 * Reproduces the `occ()` obfuscation function used on hypotheca.ca.
 *
 * Decoding rules:
 * - Letters [a-zA-Z]: ROT13
 * - Digits  [0-9]:    ROT5 (> 4 → subtract 5, ≤ 4 → add 5)
 * - Char '?':         Shift +1
 * - Escaped slashes:  Cleaned up (\/ becomes /)
 */
export function decodeHypotheca(str: string): string {
  return str
    .replace(/[a-z]/gi, (char) => {
      const code = char.charCodeAt(0);
      const offset = (95 & code) > 77 ? -13 : 13;
      return String.fromCharCode(code + offset);
    })
    .replace(/\d/g, (digit) => {
      const val = parseInt(digit);
      return (val > 4 ? val - 5 : val + 5).toString();
    })
    .replace(/\?/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) + 1);
    })
    .replace(/\\\//g, '/'); // C'est cette ligne qui sauve la mise !
}