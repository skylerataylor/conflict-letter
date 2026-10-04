import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createDocumentHandlers, validateGenerationRequest } from "../lib/document-handlers";
import { DocumentError } from "../lib/document-errors";
import { authorizeDocumentRequest } from "../lib/server-supabase";
import { ids, MemoryDatabase, recipient, renderContext, template } from "./fixtures";
import { renderDocument } from "../lib/render-document";

const payload = { matterId: ids.matter, templateId: ids.template, recipientId: ids.recipient, deliveryMethod: "email" };
function request(body: unknown = payload) {
  return new Request("http://localhost/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function handlers(db: MemoryDatabase) {
  return createDocumentHandlers(async () => ({ supabase: db.asClient(), firmId: ids.firm, author: { full_name: "Skyler Taylor" } }));
}

test("renders, persists, and returns the same reviewable draft without delivery", async () => {
  const db = new MemoryDatabase();
  const noDelivery = mock.method(globalThis, "fetch", async () => { throw new Error("Generation must not contact a delivery provider"); });
  try {
    const response = await handlers(db).POST(request({ ...payload, pleadingType: "Forged type", rendered_body: "Forged text", status: "sent" }));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const result = await response.json();
    assert.equal(result.rendered_body, renderDocument(template, renderContext()));
    assert.equal(result.pleading_type, template.pleading_type);
    assert.equal(result.status, "draft");
    assert.equal(result.matter_id, ids.matter);
    assert.equal(result.template_id, ids.template);
    assert.equal(result.recipient_id, ids.recipient);
    assert.equal(db.tables.documents.length, 1);
    assert.deepEqual(result, db.tables.documents[0]);
    assert.equal(noDelivery.mock.callCount(), 0);
    for (const table of ["matters", "contacts", "templates"]) {
      assert.ok(db.queries.filter(query => query.table === table).every(query => query.filters.some(([field, value]) => field === "firm_id" && value === ids.firm)), `${table} must be firm-scoped`);
    }
  } finally { noDelivery.mock.restore(); }
});

test("reports missing merge data and never inserts a metadata-only draft", async () => {
  const db = new MemoryDatabase();
  db.tables.contacts.find(contact => contact.id === ids.recipient)!.email = null;
  db.tables.matters[0].case_number = " ";
  const response = await handlers(db).POST(request());
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.code, "missing_data");
  assert.deepEqual(result.fields, ["matter.case_number", "recipient.email"]);
  assert.equal(db.tables.documents.length, 0);
  assert.equal(db.queries.some(query => query.operation === "insert"), false);
});

test("rejects invalid templates before saving", async () => {
  const db = new MemoryDatabase();
  db.tables.templates[0].body = "{{recipient.not_a_field}}";
  const response = await handlers(db).POST(request());
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "invalid_template");
  assert.equal(db.tables.documents.length, 0);
});

for (const table of ["matters", "templates", "contacts"] as const) {
  test(`rejects a ${table} record belonging to another firm`, async () => {
    const db = new MemoryDatabase();
    const row = table === "contacts" ? db.tables.contacts.find(contact => contact.id === ids.recipient)! : db.tables[table][0];
    row.firm_id = ids.otherFirm;
    const response = await handlers(db).POST(request());
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "not_found");
    assert.equal(db.tables.documents.length, 0);
  });
}

test("rejects an authorized contact that is unrelated to the selected matter", async () => {
  const db = new MemoryDatabase();
  db.tables.matter_contacts = [];
  const response = await handlers(db).POST(request());
  assert.equal(response.status, 404);
  assert.equal(db.tables.documents.length, 0);
});

test("accepts the matter's client as recipient without a redundant relationship row", async () => {
  const db = new MemoryDatabase();
  const response = await handlers(db).POST(request({ ...payload, recipientId: ids.client }));
  assert.equal(response.status, 201);
  assert.match((await response.json()).rendered_body, /Serve Jordan Taylor at jordan@example\.test/);
});

test("rejects a stale or cross-firm client reference", async () => {
  const db = new MemoryDatabase();
  db.tables.contacts.find(contact => contact.id === ids.client)!.firm_id = ids.otherFirm;
  const response = await handlers(db).POST(request());
  assert.equal(response.status, 422);
  assert.deepEqual((await response.json()).fields, ["client"]);
  assert.equal(db.tables.documents.length, 0);
});

test("a clientless matter can render a template that does not reference a client", async () => {
  const db = new MemoryDatabase();
  db.tables.matters[0].client_id = null;
  db.tables.templates[0].body = "Serve {{recipient.full_name}} in {{matter.case_number}}.";
  const response = await handlers(db).POST(request());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).rendered_body, "Serve Morgan Counsel in 2026-CR-123.");
});

for (const table of ["matters", "contacts", "matter_contacts", "templates", "firms"] as const) {
  test(`fails safely on a ${table} lookup error`, async () => {
    const db = new MemoryDatabase();
    db.failures.set(`${table}:select`, "sensitive database failure detail");
    const response = await handlers(db).POST(request());
    assert.equal(response.status, 500);
    assert.equal((await response.text()).includes("sensitive"), false);
    assert.equal(db.tables.documents.length, 0);
  });
}

test("does not report success when persistence fails", async () => {
  const db = new MemoryDatabase();
  db.failures.set("documents:insert", "database write failed");
  const response = await handlers(db).POST(request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "crm_error");
  assert.equal(db.tables.documents.length, 0);
});

test("validates IDs, JSON shape, and delivery enum before querying CRM records", async () => {
  for (const body of [null, [], {}, { ...payload, matterId: "MAT-2025-0142" }, { ...payload, recipientId: "opposing-counsel" }, { ...payload, templateId: null }, { ...payload, deliveryMethod: "post" }]) {
    const db = new MemoryDatabase();
    const response = await handlers(db).POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(db.queries.length, 0);
    assert.equal(db.tables.documents.length, 0);
  }
  const db = new MemoryDatabase();
  const malformed = new Request("http://localhost/api/documents", { method: "POST", body: "{" });
  assert.equal((await handlers(db).POST(malformed)).status, 400);
  for (const method of ["email", "fax", "both"]) assert.equal(validateGenerationRequest({ ...payload, deliveryMethod: method }).deliveryMethod, method);
  assert.equal(validateGenerationRequest({ matterId: ids.matter, templateId: ids.template, recipientId: ids.recipient }).deliveryMethod, "email");
});

test("GET lists only authorized selections and matter-associated recipients", async () => {
  const db = new MemoryDatabase();
  db.tables.matters.push({ ...db.tables.matters[0], id: ids.otherMatter, firm_id: ids.otherFirm });
  db.tables.templates.push({ ...db.tables.templates[0], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", firm_id: ids.otherFirm });
  db.tables.contacts.push({ ...recipient, id: ids.otherContact, firm_id: ids.otherFirm });
  db.tables.contacts.push({ ...recipient, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", full_name: "Unrelated contact" });
  db.tables.matter_contacts.push({ matter_id: ids.matter, contact_id: ids.otherContact, relationship: "opposing-counsel" });
  const response = await handlers(db).GET(new Request("http://localhost/api/documents"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const options = await response.json();
  assert.equal(options.matters.length, 1);
  assert.equal(options.templates.length, 1);
  assert.deepEqual(options.matters[0].recipients.map((contact: { id: string }) => contact.id), [ids.client, ids.recipient]);
  assert.equal("body" in options.templates[0], false);
  assert.equal("email" in options.matters[0].recipients[0], false);
});

test("GET handles empty CRM data without inventing sample selections", async () => {
  const db = new MemoryDatabase();
  db.tables.matters = [];
  db.tables.templates = [];
  const response = await handlers(db).GET(new Request("http://localhost/api/documents"));
  assert.deepEqual(await response.json(), { matters: [], templates: [] });
});

test("both endpoints require authorization before reading or writing records", async () => {
  const db = new MemoryDatabase();
  const api = createDocumentHandlers(async () => { throw new DocumentError(403, "forbidden", "Firm membership required."); });
  assert.equal((await api.POST(request())).status, 403);
  assert.equal((await api.GET(new Request("http://localhost/api/documents"))).status, 403);
  assert.equal(db.queries.length, 0);
});

test("the real authorizer rejects absent credentials and missing configuration", async () => {
  await assert.rejects(authorizeDocumentRequest(new Request("http://localhost/api/documents")), (error: unknown) => error instanceof DocumentError && error.status === 401);
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(authorizeDocumentRequest(new Request("http://localhost/api/documents", { headers: { Authorization: "Bearer token" } })), (error: unknown) => error instanceof DocumentError && error.status === 503);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

test("the real authorizer verifies the token and uses the anon key plus user JWT for RLS", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const calls: { url: string; headers: Headers }[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.includes("/auth/v1/user")) return Response.json({ id: ids.client, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (url.includes("/rest/v1/profiles")) return Response.json([{ firm_id: ids.firm, full_name: "Skyler Taylor" }]);
    throw new Error("Unexpected authorizer request");
  });
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const context = await authorizeDocumentRequest(new Request("http://localhost/api/documents", { headers: { Authorization: "Bearer verified-user-token" } }));
    assert.equal(context.firmId, ids.firm);
    assert.equal(context.author.full_name, "Skyler Taylor");
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.includes("/auth/v1/user"));
    assert.equal(new URL(calls[1].url).searchParams.get("id"), `eq.${ids.client}`);
    assert.ok(calls.every(call => call.headers.get("Authorization") === "Bearer verified-user-token"));
    assert.ok(calls.every(call => call.headers.get("apikey") === "test-anon-key"));
  } finally {
    fetchMock.mock.restore();
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});
