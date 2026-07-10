# 작품 맥락 해설 eBook 웹뷰어 — 프로토타입

KPIPA 「2026 출판콘텐츠 기술개발 지원」 기술 수준 증빙(TRL 4)용 프로토타입.
책 파일(TXT/EPUB/PDF)을 업로드하면 글로서리(인물·용어·사건·설정)를 자동 추출해
작품별 지식베이스를 만들고, 뷰어에서 단어·문장·문단을 선택하면 **작품 원문 근거가
있는 해설만** 인라인 카드로 보여주는 웹 뷰어입니다.

## 실행

```bash
cp .env.example .env.local   # 키 채우기 (아래 참고)
npm install
npm run dev                  # http://localhost:3000
```

DB 불필요 — 작품 데이터는 `data/{workId}/`에 JSON으로 저장됩니다.
첫 접속 시 현진건 「운수 좋은 날」(저작권 만료, 위키문헌)이 자동 프리로드됩니다.

## .env.local 키

| 키 | 설명 |
|---|---|
| `LLM_PROVIDER` | `openai-compat`(기본) / `anthropic` / `mock` |
| `LLM_MODEL` | 예: `gpt-4o-mini`, `claude-sonnet-4-6` |
| `LLM_BASE_URL` | OpenAI 호환 엔드포인트 (기본 `https://api.openai.com/v1`) |
| `LLM_API_KEY` | openai-compat용 키 (`OPENAI_API_KEY`로도 인식) |
| `ANTHROPIC_API_KEY` | anthropic 사용 시 |
| `EMBEDDING_PROVIDER` | `openai`(기본) / `voyage` / `local`(키 불필요 폴백) |
| `OPENAI_API_KEY` | OpenAI 임베딩/LLM 겸용 |

**키 없이도 데모 동작**: LLM 키가 없으면 해설 카드에 글로서리 설명이 직접 표시되고,
임베딩은 로컬 해시 임베딩으로 폴백합니다. 키를 채우면 근거 제한 생성 해설·후속 질문
채팅·업로드 글로서리 추출이 활성화됩니다.

## 데모 캡처 경로 (증빙 2 화면 1~5)

1. **뷰어 열람** — `/works/unsu-joeun-nal` (본문 + 진행률/읽은 위치 표시)
2. **단어 선택 해설** — 본문에서 "김 첨지" 더블클릭 → 우측 글로서리 카드
3. **문장 선택 해설** — 문장 드래그 → 문맥 반영 해설 + 근거 인용(클릭 시 본문 이동)
4. **글로서리 목록** — `/works/unsu-joeun-nal/glossary` (인물/용어/사건/설정 탭)
5. **구축 로그** — `/works/unsu-joeun-nal/build` (파싱→추출→병합→인덱싱 단계)
   - LLM 키 설정 후 "⟳ 재구축" 버튼으로 실제 LLM 추출 로그를 라이브로 캡처 가능

보너스: 해설 카드 하단 입력창에서 후속 질문 채팅, 헤더의 **스포일러 차단** 토글 +
읽기 위치 슬라이더로 차단 전/후 비교(치삼은 후반 등장 — 읽기 위치를 앞으로 두면
"작품에서 확인되지 않음").

## 자체평가 15건 (증빙 3)

뷰어 헤더의 **평가 모드**를 켜면 선택→응답이 `data/{workId}/eval_log.json`에 자동
기록됩니다. 15건(권장: 인물 5 · 용어 4 · 사건 3 · 설정 3) 수집 후 헤더의 **CSV**
링크(`/api/works/:id/eval?format=csv`)로 내려받아 증빙 3 양식에 붙여 넣으면 됩니다.
verdict 열은 공란(사람 판정용)입니다.

## 아키텍처

- **Next.js 15 단일 프로세스** (App Router + API Routes), DB 없음
- 저장: `data/{workId}/` — work.json, content.txt(오프셋 기준 원문), segments.json,
  glossary.json, embeddings.json, build.json, chats/, eval_log.json
- **오프셋 좌표계**: content.txt의 전역 문자 인덱스가 유일 기준. Segment·글로서리
  첫 등장·읽기 위치·스포일러 차단이 모두 이 좌표를 공유
- **BYOM 어댑터**: `src/lib/llm.ts`(anthropic/openai-compat/mock),
  `src/lib/embed.ts`(openai/voyage/local) — env만으로 교체
- **조회 플로우**: 선택 → 글로서리 별칭 매칭(조사 제거) + 임베딩 top-k 세그먼트 검색
  (읽기 위치 이후 제외) → 근거 제한 생성 → 해설+근거 인용+글로서리 카드
- 파이프라인: 파싱(TXT/EPUB/PDF) → 청크별 LLM 글로서리 추출 → 이름/별칭 병합 →
  언급 오프셋 스캔 → 임베딩 인덱싱, 진행 로그는 `/build` 화면에 스트리밍
