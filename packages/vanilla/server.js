import express from "express";
import { createServer } from "vite";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import compression from "compression";
import sirv from "sirv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prod = process.env.NODE_ENV === "production";
const port = process.env.PORT || 5173;
const base = process.env.BASE || (prod ? "/front_6th_chapter4-1/vanilla/" : "/");

// http 서버(express, vite)

const app = express();
let vite;

// 환경 분기
if (!prod) {
  // 개발 환경: Vite dev server + middleware
  vite = createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
} else {
  // 프로덕션 환경: compression + sirv
  app.use(compression());
  app.use(base, sirv(resolve(__dirname, "dist/vanilla"), { dev: false }));
}

// SSR 라우트
app.use("*", async (req, res, next) => {
  const url = req.originalUrl.replace(base, "");

  try {
    // 1. HTML 템플릿 읽기
    let template = fs.readFileSync(resolve(__dirname, prod ? "dist/vanilla/index.html" : "index.html"), "utf-8");

    if (!prod) {
      // 2. Vite HTML 변환 (개발 환경에서만)
      template = await vite.transformIndexHtml(url, template);
    }

    // 3. 서버 엔트리 로드
    const { render } = !prod
      ? await vite.ssrLoadModule("/src/main-server.js")
      : await import("./dist/vanilla-ssr/main-server.js");

    // 4. 앱 HTML 렌더링
    const { html: appHtml, head, initialData } = await render(url);

    // 5. 템플릿에 렌더링된 HTML 주입
    const html = template
      .replace("<!--app-head-->", head)
      .replace("<!--app-html-->", appHtml)
      .replace("</head>", `${initialData}</head>`);

    // 6. 렌더링된 HTML 응답
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    if (!prod) {
      // 개발 환경에서 스택 트레이스 수정
      vite.ssrFixStacktrace(e);
    }
    console.error("SSR Error:", e);
    next(e);
  }
});

// 서버 시작
app.listen(port, () => {
  console.log(` Vanilla SSR Server started at http://localhost:${port}`);
  console.log(`📁 Base path: ${base}`);
  console.log(`🌍 Environment: ${prod ? "production" : "development"}`);
});
