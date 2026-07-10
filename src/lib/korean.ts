// 한국어 조사 제거 + 정규화 유틸 (글로서리 별칭 매칭용)

const JOSA = [
  "으로부터", "에게서", "으로서", "으로써", "이라고", "이라는", "야말로",
  "에서는", "에서도", "한테서", "부터는", "까지는", "이라도", "일지라도",
  "에게는", "에게도", "라고는",
  "에서", "에게", "한테", "부터", "까지", "조차", "마저", "밖에",
  "처럼", "만큼", "보다", "이나", "이란", "이든", "라고", "라는", "로서",
  "로써", "이며", "이자", "인데", "께서", "이다", "였다", "이었다",
  "은", "는", "이", "가", "을", "를", "과", "와", "도", "만", "의",
  "에", "로", "야", "나", "랑", "요", "며", "든", "란",
];

// 긴 조사부터 시도
const JOSA_SORTED = [...JOSA].sort((a, b) => b.length - a.length);

export function stripPunct(s: string): string {
  return s
    .replace(/[\s ]+/g, " ")
    .replace(/^[\s"'“”‘’「」『』(),.!?…\-–—:;·]+|[\s"'“”‘’「」『』(),.!?…\-–—:;·]+$/g, "")
    .trim();
}

/** 어절 끝 조사를 제거한 후보들을 반환 (원형 포함) */
export function josaVariants(word: string): string[] {
  const base = stripPunct(word);
  const out = new Set<string>([base]);
  for (const j of JOSA_SORTED) {
    if (base.length > j.length + 0 && base.endsWith(j)) {
      const stem = base.slice(0, base.length - j.length);
      if (stem.length >= 1) out.add(stem);
    }
  }
  return [...out];
}

export function normalizeName(s: string): string {
  return stripPunct(s).replace(/\s+/g, "");
}

/** 선택 텍스트(단어)가 글로서리 이름/별칭과 일치하는지 */
export function matchesName(selection: string, names: string[]): boolean {
  const targets = names.map(normalizeName).filter(Boolean);
  for (const v of josaVariants(selection)) {
    const nv = normalizeName(v);
    if (!nv) continue;
    if (targets.includes(nv)) return true;
  }
  return false;
}

/** 텍스트(문장/문단)에 이름/별칭이 포함되어 있는지 */
export function containsName(text: string, names: string[]): boolean {
  const flat = text.replace(/\s+/g, "");
  return names.some((n) => {
    const nn = normalizeName(n);
    return nn.length >= 2 && flat.includes(nn);
  });
}

/** 원문에서 이름/별칭의 등장 오프셋 모두 수집 */
export function findMentionOffsets(text: string, names: string[]): number[] {
  const offsets = new Set<number>();
  for (const name of names) {
    const n = stripPunct(name);
    if (n.length < 2) continue;
    // 공백 유무 변형 (예: "김 첨지" ↔ "김첨지")
    const variants = new Set([n, n.replace(/\s+/g, "")]);
    if (!n.includes(" ") && n.length >= 3) {
      // 성+공백+이름 형태도 시도
      variants.add(n.slice(0, 1) + " " + n.slice(1));
    }
    for (const v of variants) {
      let idx = text.indexOf(v);
      while (idx !== -1) {
        offsets.add(idx);
        idx = text.indexOf(v, idx + 1);
      }
    }
  }
  return [...offsets].sort((a, b) => a - b);
}

/** 문장 분리 (해설 문맥 표시용) */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…다””])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
