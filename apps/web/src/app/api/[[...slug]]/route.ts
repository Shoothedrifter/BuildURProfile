import { handleNextRouteRequest } from "../../../server/runtime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleNextRouteRequest(request);
}

export async function HEAD(request: Request) {
  return handleNextRouteRequest(request);
}

export async function POST(request: Request) {
  return handleNextRouteRequest(request);
}

export async function PUT(request: Request) {
  return handleNextRouteRequest(request);
}

export async function DELETE(request: Request) {
  return handleNextRouteRequest(request);
}
