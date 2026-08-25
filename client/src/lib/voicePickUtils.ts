// Lightweight fuzzy match (no dependency added): exact/substring match scores highest,
// otherwise scores by the fraction of query tokens that appear in the candidate. Good
// enough for matching a spoken player or franchise name against a short known list —
// not meant for large free-text search.
export function scoreMatch(query: string, candidate: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const q = normalize(query); const c = normalize(candidate);
  if (!q || !c) return 0;
  if (c === q) return 100;
  if (c.includes(q) || q.includes(c)) return 80;
  const qTokens = q.split(/\s+/); const cTokens = c.split(/\s+/);
  const overlap = qTokens.filter(token => cTokens.some(candidateToken => candidateToken === token || candidateToken.startsWith(token) || token.startsWith(candidateToken))).length;
  return (overlap / Math.max(qTokens.length, cTokens.length)) * 60;
}

export function bestMatch<T>(query: string, items: T[], getLabel: (item: T) => string): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = scoreMatch(query, getLabel(item));
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score > 30 ? best : null;
}

// Chrome's speech recognition already converts spoken numbers to digits in most cases
// ("sixteen dollars" -> "16 dollars"), so a plain digit regex covers the common case.
export function parseSalaryFromTranscript(transcript: string): number | null {
  const match = transcript.match(/\$?\s*(\d+)\s*(dollars?)?/i);
  return match ? Number(match[1]) : null;
}

export function useSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;
  const instance = new SpeechRecognitionCtor();
  instance.lang = "en-US";
  instance.interimResults = false;
  instance.maxAlternatives = 1;
  return instance;
}
