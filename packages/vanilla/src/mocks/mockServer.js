import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

// MSW 서버 설정 - Node.js 환경에서 API 요청을 가로채기 위한 설정
export const mockServer = setupServer(...handlers);
