import { createDocumentHandlers } from "@/lib/document-handlers";

export const runtime = "nodejs";
const handlers = createDocumentHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
