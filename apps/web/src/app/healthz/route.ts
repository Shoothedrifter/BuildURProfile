import { handleNextRouteRequest } from "../../server/runtime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleNextRouteRequest(request);
}
