# LexFlow

A Next.js legal practice workspace for CRM-backed pleading generation and email/fax delivery. The dashboard still shows representative data; the pleading generator uses only authorized Supabase CRM records.

## Local setup

1. `npm ci`
2. Copy `.env.example` to `.env.local` and add Supabase credentials.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. `npm run dev`
5. Open **Generate pleading** and sign in with a Supabase Auth email/password account. Existing browser sessions are reused. The account must have a `profiles` row with its `firm_id`, and the firm needs matters, contacts, and templates. Recipients must be the matter's client or linked through `matter_contacts`.

## Draft generation

Both document endpoints require `Authorization: Bearer <Supabase access token>`. The server verifies the token with Supabase Auth, resolves the user's firm profile, and uses the public anon key with the user JWT so row-level security remains active. Generation does not need a service-role key. Missing configuration, expired sessions, unavailable records, and database failures return errors; there is no fabricated success response.

`GET /api/documents` returns the user's firm-scoped matter/template choices and each matter's associated recipients. It does not return template bodies or contact delivery addresses.

`POST /api/documents` accepts:

```json
{
  "matterId": "<matter UUID>",
  "templateId": "<template UUID>",
  "recipientId": "<associated contact UUID>",
  "deliveryMethod": "email"
}
```

`deliveryMethod` can be `email`, `fax`, or `both` (default `email`). The pleading type comes from the selected template. The server loads the authorized matter, recipient, client (if linked), template, firm name, and author profile; renders the template; then inserts a document with `template_id`, `recipient_id`, `rendered_body`, and `status: "draft"`. A `201` response contains the saved document, including its full `rendered_body`. The generator keeps that text visible for review and labels it **Draft saved · Not sent**. The delivery preference is saved as metadata; generating a draft never calls the delivery endpoint or a delivery provider.

Errors include an `error` message, `code`, and (where applicable) `fields`. Invalid requests return `400`, unavailable or unauthorized selections return `404`, and missing/invalid merge values or malformed templates return `422`. Rendering failures do not insert a draft. Optional CRM fields are required only when the selected template references them. If a matter has a client reference, that client must be available in the same firm.

## Template format

Template bodies are plain text. Merge fields use `{{field.path}}` with optional surrounding whitespace. Supported fields are:

- `matter.case_name`, `matter.case_number`, `matter.court_name`, `matter.case_type`, `matter.status`, `matter.next_date` (a valid `YYYY-MM-DD` date).
- `client.full_name`, `client.company`, `client.email`, `client.fax` and the corresponding `recipient.*` fields.
- `client.address.line1`, `client.address.line2`, `client.address.city`, `client.address.state`, `client.address.postal_code`, `client.address.country` and the corresponding `recipient.address.*` fields. Use these keys in the contacts table's `address` JSON object.
- `firm.name` and `author.full_name` (the authenticated user's profile).

Unknown merge fields are rejected. Referenced values must be nonblank strings; email values must have email syntax. Templates do not evaluate expressions, traverse arbitrary objects, or recursively expand contact text. The preview renders as React text, preserving line breaks without interpreting HTML.

For a single text body, set `ordering_rules` to `[]`. For ordered sections, put **all** template text inside unique named blocks and store an array naming every section exactly once:

```text
{{#section service}}
Service recipient: {{recipient.full_name}} ({{recipient.email}})
{{/section}}

{{#section caption}}
{{matter.court_name}}
{{matter.case_name}}
Case No. {{matter.case_number}}
{{/section}}

{{#section body}}
Counsel appears on behalf of {{client.full_name}}.
{{author.full_name}}
{{firm.name}}
{{/section}}
```

```json
["caption", "body", "service"]
```

Section names use lowercase letters, digits, and underscores, starting with a letter. With `ordering_rules: []`, named sections retain their source order. Nested/repeated blocks, text outside blocks, incomplete tokens, unknown/duplicate ordering entries, and omitted sections are rejected to prevent lost or misplaced text. Existing schema fields support this flow without a database migration.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Focused tests cover merged output and section order, required/optional data, malformed fields and templates, firm/recipient authorization, failed reads/writes, authenticated RLS access, and draft persistence without delivery. Database tests use an in-memory PostgREST double; authentication tests stub Supabase HTTP responses. A live Supabase project is needed to verify deployed RLS policies and real CRM integration.

`POST /api/deliveries` remains a separate provider integration for email/fax. This change does not wire automatic sending into draft generation.
