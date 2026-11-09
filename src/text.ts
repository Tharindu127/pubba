/** Lowercase, accents off, punctuation to spaces (keeping `+ # .` for C#, C++, Next.js). */
export const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const lowerKey = (s: string): string => s.trim().toLowerCase();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does this text name this, as a whole word? */
export const mentions = (text: string, name: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${escapeRe(lowerKey(name))}([^a-z0-9]|$)`, "i").test(text);

/** Edit distance with a swap of two neighbouring letters counted once ("moblie", "contcat"). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  const row0 = d[0]!;
  for (let j = 1; j <= b.length; j++) row0[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const row = d[i]!;
    const prev = d[i - 1]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Does a typed word mean this word? Exact, plural, prefix, or a near miss. */
export function closeTo(token: string | undefined, word: string, typoMinLength = 4): boolean {
  if (!token) return false;
  if (token === word || token === `${word}s`) return true;
  // Short words and names with symbols (go, js, c#, next.js) must match exactly.
  if (word.length < 4 || /[^a-z]/.test(word)) return false;
  if (token.startsWith(word)) return true;
  if (token.length < 3 || word.length < typoMinLength) return false;
  const max = word.length >= 7 ? 2 : 1;
  return editDistance(token, word) <= max || (token.length > word.length && editDistance(token.slice(0, word.length), word) <= max);
}

/** Does a normalised query contain any of these phrases, word by word, typos allowed? */
export function hasPhrase(query: string, ...phrases: string[]): boolean {
  return hasPhraseWith(query, phrases, 4);
}

/** `hasPhrase` with the shortest word that may carry a typo. */
export function hasPhraseWith(query: string, phrases: string[], typoMinLength: number): boolean {
  const tokens = query.split(" ");
  return phrases.some((phrase) => {
    const words = phrase.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((w, j) => closeTo(tokens[i + j], w, typoMinLength))) return true;
    }
    return false;
  });
}

/** Does a normalised query contain this normalised name as whole words? */
export const containsName = (query: string, name: string): boolean => ` ${query} `.includes(` ${name} `);
