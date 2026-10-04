import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentError } from "../lib/document-errors";
import { renderDocument } from "../lib/render-document";
import { renderContext, template } from "./fixtures";

test("merges matter, client, recipient, firm, and author into a complete plain-text pleading", () => {
  assert.equal(renderDocument(template, renderContext()), "State Court of Fayette County\nState v. Taylor\nCase No. 2026-CR-123\n\nCounsel appears for Jordan Taylor.\nServe Morgan Counsel at morgan@example.test.\nSkyler Taylor\nTaylor Legal");
});

test("honors section ordering without losing caption or service text", () => {
  const sections = { ...template, body: "{{#section service}}Service: {{recipient.full_name}}{{/section}}\n{{#section caption}}{{matter.court_name}}\n{{matter.case_number}}{{/section}}\n{{#section body}}Appear for {{client.full_name}}.{{/section}}", ordering_rules: ["caption", "body", "service"] };
  assert.equal(renderDocument(sections, renderContext()), "State Court of Fayette County\n2026-CR-123\n\nAppear for Jordan Taylor.\n\nService: Morgan Counsel");
  assert.equal(renderDocument({ ...sections, ordering_rules: [] }, renderContext()), "Service: Morgan Counsel\n\nState Court of Fayette County\n2026-CR-123\n\nAppear for Jordan Taylor.");
});

test("deduplicates and reports all referenced missing fields", () => {
  const context = renderContext();
  context.matter.case_number = "   ";
  context.recipient.email = null;
  context.client = null;
  assert.throws(() => renderDocument({ ...template, body: "{{matter.case_number}} {{recipient.email}} {{client.full_name}} {{recipient.email}}" }, context), (error: unknown) => {
    assert.ok(error instanceof DocumentError);
    assert.equal(error.status, 422);
    assert.equal(error.code, "missing_data");
    assert.deepEqual(error.fields, ["matter.case_number", "recipient.email", "client.full_name"]);
    return true;
  });
});

test("unreferenced optional contact fields do not block a draft", () => {
  const context = renderContext();
  context.client = null;
  context.recipient.email = null;
  context.recipient.fax = null;
  assert.equal(renderDocument({ ...template, body: "Case {{matter.case_number}} for {{recipient.full_name}}" }, context), "Case 2026-CR-123 for Morgan Counsel");
});

test("merges known address fields and validates real calendar dates", () => {
  assert.equal(renderDocument({ ...template, body: "{{recipient.address.line1}}, {{recipient.address.city}} {{recipient.address.state}} {{recipient.address.postal_code}}\n{{matter.next_date}}" }, renderContext()), "2 Court Street, Atlanta GA 30303\n2026-10-20");
  const context = renderContext();
  context.matter.next_date = "2026-02-30";
  assert.throws(() => renderDocument({ ...template, body: "{{matter.next_date}}" }, context), (error: unknown) => error instanceof DocumentError && error.code === "invalid_data");
});

test("rejects missing address components and malformed email values", () => {
  const context = renderContext();
  context.recipient.address = [];
  assert.throws(() => renderDocument({ ...template, body: "{{recipient.address.line1}}" }, context), (error: unknown) => error instanceof DocumentError && error.code === "missing_data");
  context.recipient.email = "not-an-email";
  assert.throws(() => renderDocument(template, context), (error: unknown) => error instanceof DocumentError && error.code === "invalid_data" && error.fields.includes("recipient.email"));
});

test("rejects non-text CRM values rather than stringifying them", () => {
  const context = renderContext();
  context.recipient.address = { line1: { unexpected: "object" } };
  assert.throws(() => renderDocument({ ...template, body: "{{recipient.address.line1}}" }, context), (error: unknown) => error instanceof DocumentError && error.code === "invalid_data");
});

test("does not recursively expand tokens or replacement syntax from CRM text", () => {
  const context = renderContext();
  context.client!.full_name = "{{recipient.email}} $& <script>alert(1)</script>";
  assert.equal(renderDocument({ ...template, body: "Client: {{ client.full_name }}" }, context), "Client: {{recipient.email}} $& <script>alert(1)</script>");
});

for (const field of ["matter.unknown", "recipient.__proto__", "constructor", "client.address.toString", ""]) {
  test(`rejects unsupported field '${field}'`, () => {
    assert.throws(() => renderDocument({ ...template, body: `{{${field}}}` }, renderContext()), (error: unknown) => error instanceof DocumentError && error.code === "invalid_template");
  });
}

for (const [name, body, ordering_rules] of [
  ["blank body", " ", []],
  ["incomplete field", "{{matter.case_number", []],
  ["malformed token", "{{{matter.case_number}}}", []],
  ["unclosed section", "{{#section caption}}Case", []],
  ["nested section", "{{#section a}}{{#section b}}Text{{/section}}{{/section}}", []],
  ["duplicate section", "{{#section a}}First{{/section}}{{#section a}}Second{{/section}}", []],
  ["text outside sections", "Do not lose this{{#section a}}Text{{/section}}", ["a"]],
  ["omitted section", "{{#section a}}A{{/section}}{{#section b}}B{{/section}}", ["a"]],
  ["unknown section", "{{#section a}}A{{/section}}", ["b"]],
  ["duplicate rule", "{{#section a}}A{{/section}}", ["a", "a"]],
  ["rules without sections", "Text", ["caption"]],
  ["object rules", "Text", { caption: 1 }],
] as const) {
  test(`rejects template with ${name}`, () => {
    assert.throws(() => renderDocument({ ...template, body, ordering_rules }, renderContext()), (error: unknown) => error instanceof DocumentError && error.status === 422 && error.code === "invalid_template");
  });
}
