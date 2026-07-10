import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "작품 맥락 해설 eBook 뷰어",
  description:
    "작품별 지식베이스 기반 근거 제한 해설 웹뷰어 — KPIPA 2026 출판콘텐츠 기술개발 프로토타입 (TRL 4)",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
