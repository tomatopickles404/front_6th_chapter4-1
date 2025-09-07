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

// ===== 유틸리티 함수들 =====
function normalizeUrl(originalUrl, basePath) {
  const withoutBase = originalUrl.replace(basePath, "") || "/";
  const withSlash = withoutBase.startsWith("/") ? withoutBase : "/" + withoutBase;
  return withSlash.replace(/\/+/g, "/");
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
    // 개발 환경: Vite 미들웨어 사용 (HMR, 실시간 변환 등)
    app.use(vite.middlewares);
    console.log("🔧 개발 미들웨어 설정 완료");
  } else {
    // 프로덕션 환경: 압축 및 정적 파일 서빙
    app.use(compression());
    app.use(base, sirv("./dist/react", { extensions: [] }));
    console.log("🏗️ 프로덕션 미들웨어 설정 완료");
  }
}

// ===== SSR 렌더링 핸들러 =====
async function handleSSRRendering(req, res) {
  try {
    // URL 정규화
    const normalizedUrl = normalizeUrl(req.originalUrl, base);

    let currentTemplate = template;
    let currentRender = render;

    // 개발 환경에서만 실시간 모듈 로드
    if (!isProduction) {
      currentTemplate = await fs.readFile("./index.html", "utf-8");
      currentTemplate = await vite.transformIndexHtml(normalizedUrl, currentTemplate);
      currentRender = (await vite.ssrLoadModule("/src/main-server.tsx")).render;
    }

    // React 컴포넌트 서버사이드 렌더링
    const renderResult = await currentRender(normalizedUrl, req.query);

    // 템플릿에 렌더링 결과 주입
    const finalHtml = injectTemplate(currentTemplate, renderResult);

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

// SSR 렌더링 미들웨어 - API 경로 제외한 모든 요청 처리
app.use(/^(?!.*\/api).*$/, handleSSRRendering);

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
