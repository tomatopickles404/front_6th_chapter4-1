import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { router } from "./router";
import { HomePage, ProductDetailPage, NotFoundPage } from "./pages";
import { productStore } from "./entities/products/productStore";
import type { Product, Categories } from "./entities/products/types";
import items from "./mocks/items.json" with { type: "json" };

// ===== 추가 타입 정의 =====
interface ProductData {
  products: Product[];
  categories: Categories;
  totalCount: number;
}

interface ProductDetailData {
  currentProduct: Product;
  relatedProducts: Product[];
}

interface RouteParams {
  id?: string;
  [key: string]: string | undefined;
}

interface RenderResult {
  initialData: ProductData | ProductDetailData | Record<string, never>;
  html: string;
  head: string;
}

// ===== 데이터 로딩 유틸리티 함수들 =====
function getUniqueCategories(): Categories {
  const categories: Categories = {};

  items.forEach((item: Product) => {
    const cat1 = item.category1;
    const cat2 = item.category2;

    if (!categories[cat1]) categories[cat1] = {};
    if (cat2 && !categories[cat1][cat2]) categories[cat1][cat2] = {};
  });

  return categories;
}

function getProductById(id: string): Product | undefined {
  return items.find((item: Product) => item.productId === id);
}

function getRelatedProducts(category2: string, productId: string): Product[] {
  return items.filter((p: Product) => p.category2 === category2 && p.productId !== productId).slice(0, 4);
}

/**
 * 홈페이지 라우트 - 상품 목록과 카테고리 표시
 */
router.addRoute("/", () => {
  const categories = getUniqueCategories();
  // 라우터에서 쿼리를 가져와서 사용
  const currentQuery = (router as { query: Record<string, string> }).query || {};
  const filteredProducts = filterProducts(items, currentQuery);
  const limit = 20;
  const paginatedProducts = filteredProducts.slice(0, limit);

  // 서버 상태 초기화
  const productData: ProductData = {
    products: paginatedProducts,
    categories,
    totalCount: filteredProducts.length,
  };

  // 스토어에 초기 데이터 설정
  productStore.dispatch({
    type: "products/setup",
    payload: productData,
  });

  return renderToString(createElement(HomePage));
});

/**
 * 상품 상세 페이지 라우트 - 상품 정보와 관련 상품 표시
 */
router.addRoute("/product/:id/", (params: RouteParams) => {
  const product = getProductById(params.id || "");

  // 존재하지 않는 상품인 경우
  if (!product) {
    return renderToString(createElement(NotFoundPage));
  }

  const relatedProducts = getRelatedProducts(product.category2, product.productId);

  // 서버 상태 초기화
  const productDetailData: ProductDetailData = {
    currentProduct: product,
    relatedProducts,
  };

  productStore.dispatch({
    type: "products/setup",
    payload: productDetailData,
  });

  return renderToString(createElement(ProductDetailPage));
});

/**
 * 404 페이지 - 모든 매칭되지 않은 경로
 */
router.addRoute(".*", () => renderToString(createElement(NotFoundPage)));

// 상품 검색 및 필터링 함수
function filterProducts(products: Product[], query: Record<string, string>): Product[] {
  let filtered = [...products];

  // 검색어 필터링
  if (query.search) {
    const searchTerm = query.search.toLowerCase();
    filtered = filtered.filter(
      (item) => item.title.toLowerCase().includes(searchTerm) || item.brand.toLowerCase().includes(searchTerm),
    );
  }

  // 카테고리 필터링
  if (query.category1) {
    filtered = filtered.filter((item) => item.category1 === query.category1);
  }
  if (query.category2) {
    filtered = filtered.filter((item) => item.category2 === query.category2);
  }

  // 정렬 - 기본값을 price_asc로 변경
  const sort = query.sort || "price_asc";
  switch (sort) {
    case "price_asc":
      filtered.sort((a, b) => parseInt(a.lprice) - parseInt(b.lprice));
      break;
    case "price_desc":
      filtered.sort((a, b) => parseInt(b.lprice) - parseInt(a.lprice));
      break;
    case "name_asc":
      filtered.sort((a, b) => a.title.localeCompare(b.title, "ko"));
      break;
    case "name_desc":
      filtered.sort((a, b) => b.title.localeCompare(a.title, "ko"));
      break;
    default:
      // 기본은 가격 낮은 순
      filtered.sort((a, b) => parseInt(a.lprice) - parseInt(b.lprice));
  }

  return filtered;
}

export const render = async (
  url: string,
  query: Record<string, string>,
): Promise<RenderResult & { __INITIAL_DATA__?: unknown }> => {
  try {
    // 직접 URL 매칭으로 컴포넌트 렌더링
    let html: string;

    if (url === "/" || url === "") {
      // 홈페이지
      const categories = getUniqueCategories();
      const filteredProducts = filterProducts(items, query);
      const limit = 20;
      const paginatedProducts = filteredProducts.slice(0, limit);

      // SSR에서 store 초기화
      productStore.dispatch({
        type: "products/setup",
        payload: {
          products: paginatedProducts,
          categories,
          totalCount: filteredProducts.length,
        },
      });

      html = renderToString(createElement(HomePage));
    } else if (url.startsWith("/product/")) {
      // 상품 상세 페이지
      const productId = url.split("/")[2];
      const product = getProductById(productId);

      if (!product) {
        html = renderToString(createElement(NotFoundPage));
      } else {
        html = renderToString(createElement(ProductDetailPage));
      }
    } else {
      // 404 페이지
      html = renderToString(createElement(NotFoundPage));
    }

    // 초기 데이터 설정
    let initialData: unknown = {};
    if (url === "/" || url === "") {
      const categories = getUniqueCategories();
      const filteredProducts = filterProducts(items, query);
      const limit = 20;
      const paginatedProducts = filteredProducts.slice(0, limit);
      initialData = {
        products: paginatedProducts,
        categories,
        totalCount: filteredProducts.length,
      };
    } else if (url.startsWith("/product/")) {
      const productId = url.split("/")[2];
      const product = getProductById(productId);
      if (product) {
        const relatedProducts = getRelatedProducts(product.category2, product.productId);
        initialData = {
          currentProduct: product,
          relatedProducts,
        };
      }
    }

    // 헤드 태그 설정
    let head = "<title>쇼핑몰</title>";
    if (url === "/" || url === "") {
      head = "<title>쇼핑몰 - 홈</title>";
    } else if (url.startsWith("/product/")) {
      const productId = url.split("/")[2];
      const product = getProductById(productId);
      if (product) {
        head = `<title>${product.title} - 쇼핑몰</title>`;
      }
    }

    console.log("✅ React SSR 완료:", url);
    return {
      html: html as string,
      head,
      initialData: initialData as ProductData | ProductDetailData | Record<string, never>,
      __INITIAL_DATA__: initialData,
    };
  } catch (error) {
    console.error("❌ React SSR 에러:", error);
    console.error("📍 에러 스택:", error instanceof Error ? error.stack : "No stack trace");
    console.error("📍 URL:", url);
    console.error("📍 Query:", query);
    // 에러 발생 시 기본 에러 페이지 반환
    return {
      head: "<title>에러 - 쇼핑몰</title>",
      html: renderToString(createElement(NotFoundPage)),
      initialData: {},
      __INITIAL_DATA__: { error: error instanceof Error ? error.message : String(error) },
    };
  }
};
