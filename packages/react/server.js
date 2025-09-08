import compression from "compression";
import express from "express";
import fs from "node:fs/promises";
import sirv from "sirv";
import { createServer } from "vite";

const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 5174;
const base = process.env.BASE || (isProduction ? "/front_6th_chapter4-1/react/" : "/");

let template;
let render;
let vite;

async function initializeDevelopmentServer() {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    base,
  });

  const { mswServer } = await vite.ssrLoadModule("./src/mocks/node.ts");
  mswServer.listen({ onUnhandledRequest: "bypass" });

  console.log("✅ MSW 서버 시작 완료");
  return vite;
}

async function initializeProductionServer() {
  console.log("🏗️ 프로덕션 서버 초기화 중...");

  // 프로덕션 템플릿 미리 로드
  template = await fs.readFile("./dist/react/index.html", "utf-8");
  render = (await import("./dist/react-ssr/main-server.js")).render;

  console.log("✅ 프로덕션 서버 초기화 완료");
}

function normalizeUrl(originalUrl, basePath) {
  if (originalUrl.startsWith(basePath)) {
    const withoutBase = originalUrl.substring(basePath.length);
    return withoutBase || "/";
  }
  // basePath로 시작하지 않는 경우 원본 URL 반환
  return originalUrl.startsWith("/") ? originalUrl : "/" + originalUrl;
}

function createInitialDataScript(initialData) {
  return initialData ? `<script>window.__INITIAL_DATA__ = ${JSON.stringify(initialData)}</script>` : "";
}

function injectTemplate(template, renderResult) {
  const initialDataScript = createInitialDataScript(renderResult.__INITIAL_DATA__);

  return template
    .replace("<!--app-head-->", renderResult.head ?? "")
    .replace("<!--app-html-->", renderResult.html ?? "")
    .replace("<!-- app-data -->", initialDataScript);
}

// ===== 서버 초기화 =====
if (!isProduction) {
  vite = await initializeDevelopmentServer();
} else {
  await initializeProductionServer();
}

const app = express();

// ===== 미들웨어 설정 =====
function setupMiddlewares() {
  if (!isProduction) {
    // 개발 환경: Vite 미들웨어를 먼저 등록, HTML 요청만 SSR로 처리
    app.use((req, res, next) => {
      const url = req.originalUrl;

      // Vite 개발 서버 관련 요청들
      if (
        url.includes("/@vite") ||
        url.includes("/@react-refresh") ||
        url.includes("/src/") ||
        url.includes("/node_modules/") ||
        url.endsWith(".js") ||
        url.endsWith(".ts") ||
        url.endsWith(".tsx") ||
        url.endsWith(".css") ||
        url.endsWith(".png") ||
        url.endsWith(".jpg") ||
        url.endsWith(".jpeg") ||
        url.endsWith(".gif") ||
        url.endsWith(".svg") ||
        url.endsWith(".ico") ||
        url.endsWith(".woff") ||
        url.endsWith(".woff2") ||
        url.includes("/api") ||
        url.includes("/assets")
      ) {
        return vite.middlewares(req, res, next);
      }

      // HTML 요청은 다음 미들웨어(SSR)로 전달
      next();
    });
    console.log("🔧 개발 미들웨어 설정 완료");
  } else {
    // 프로덕션 환경: 압축 및 정적 파일 서빙
    app.use(compression());

    // 정적 파일만 서빙 (HTML은 제외)
    app.use(base, (req, res, next) => {
      const url = req.url || "";

      // HTML 페이지 요청은 SSR로 전달
      if (url === "/" || url === "/index.html" || url.match(/^\/[^.]*$/) || url.match(/^\/.*\/[^.]*$/)) {
        return next();
      }

      // 정적 파일들 (.js, .css, .svg 등)만 sirv로 처리
      sirv("./dist/react", {
        extensions: [],
        single: false,
        onNoMatch: (_req, _res, next) => {
          // 정적 파일이 없으면 다음 미들웨어로 전달
          next();
        },
      })(req, res, next);
    });

    console.log("🏗️ 프로덕션 미들웨어 설정 완료");
  }
}

// ===== SSR 렌더링 핸들러 =====
async function handleSSRRendering(req, res) {
  try {
    // URL 정규화
    const normalizedUrl = normalizeUrl(req.originalUrl, base);

    // 디버깅: URL 정보 출력
    console.log("🔍 SSR 요청:", {
      originalUrl: req.originalUrl,
      base: base,
      normalizedUrl: normalizedUrl,
      query: req.query,
    });

    let currentTemplate = template;
    let currentRender = render;

    // 개발 환경에서만 실시간 모듈 로드
    if (!isProduction) {
      try {
        currentTemplate = await fs.readFile("./index.html", "utf-8");
        currentTemplate = await vite.transformIndexHtml(normalizedUrl, currentTemplate);
        // 안전한 모듈 로딩을 위해 try-catch 사용
        const serverModule = await vite.ssrLoadModule("/src/main-server.tsx");
        currentRender = serverModule.render;
      } catch (moduleError) {
        console.error("❌ 모듈 로딩 에러:", moduleError.message);
        // 폴백: 기본 HTML 반환
        const fallbackHtml = currentTemplate
          .replace("<!--app-head-->", "<title>서버 에러</title>")
          .replace("<!--app-html-->", "<div>서버 렌더링에 문제가 발생했습니다.</div>")
          .replace("<!-- app-data -->", "");
        return res.status(500).set({ "Content-Type": "text/html" }).send(fallbackHtml);
      }
    }

    // React 컴포넌트 서버사이드 렌더링
    console.log("🚀 SSR 렌더링 시작:", normalizedUrl);
    const renderResult = await currentRender(normalizedUrl, req.query);
    console.log("✅ SSR 렌더링 완료:", {
      htmlLength: renderResult.html?.length || 0,
      hasInitialData: !!renderResult.__INITIAL_DATA__,
      head: renderResult.head,
    });

    // 템플릿에 렌더링 결과 주입
    const finalHtml = injectTemplate(currentTemplate, renderResult);
    console.log("📄 최종 HTML 생성 완료, 길이:", finalHtml.length);

    res.status(200).set({ "Content-Type": "text/html" }).send(finalHtml);
  } catch (error) {
    handleSSRError(error, res);
  }
}

function handleSSRError(error, res) {
  // 개발 환경에서 스택 트레이스 정리
  if (!isProduction && vite) {
    vite.ssrFixStacktrace(error);
  }

  console.error("❌ SSR 렌더링 에러:", error.message);
  console.error("📍 에러 스택:", error.stack);

  res.status(500).end(error.stack || error.message);
}

// ===== 미들웨어 등록 =====
setupMiddlewares();

// HTML 페이지 요청을 SSR로 처리 (와일드카드 대신 catch-all 함수 사용)
app.use((req, res, next) => {
  // 이미 응답이 전송되었으면 다음 미들웨어로
  if (res.headersSent) {
    return next();
  }
  // SSR 처리
  handleSSRRendering(req, res);
});

// ===== 서버 시작 =====
function startServer() {
  app.listen(port, () => {
    console.log("=".repeat(50));
    console.log(`🚀 React SSR 서버 실행: http://localhost:${port}`);
    console.log(`📦 환경: ${isProduction ? "프로덕션" : "개발"} 모드`);
    console.log(`🔗 Base URL: ${base}`);
    console.log("=".repeat(50));
  });
}

// 서버 시작
startServer();
