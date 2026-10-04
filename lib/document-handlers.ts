import { DocumentError } from "./document-errors";
import type { ContactRecord, GenerationOptions, GenerationRequest, MatterRecord, TemplateRecord } from "./document-types";
import { renderDocument } from "./render-document";
import { authorizeDocumentRequest, type AuthorizedContext } from "./server-supabase";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const matterColumns = "id, firm_id, client_id, case_name, case_number, court_name, case_type, status, next_date";
const contactColumns = "id, firm_id, full_name, company, email, fax, address";
const draftColumns = "id, matter_id, template_id, recipient_id, pleading_type, rendered_body, delivery_method, status, created_at";

export function validateGenerationRequest(payload: unknown): GenerationRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DocumentError(400, "invalid_request", "A JSON object is required.");
  }
  const input = payload as Record<string, unknown>;
  const invalid = ["matterId", "templateId", "recipientId"].filter(field => typeof input[field] !== "string" || !uuid.test(input[field] as string));
  if (invalid.length) throw new DocumentError(400, "invalid_request", `Valid IDs are required for: ${invalid.join(", ")}.`, invalid);
  const deliveryMethod = input.deliveryMethod ?? "email";
  if (!["email", "fax", "both"].includes(deliveryMethod as string)) {
    throw new DocumentError(400, "invalid_request", "Choose email, fax, or both as the delivery method.", ["deliveryMethod"]);
  }
  return { matterId: input.matterId as string, templateId: input.templateId as string, recipientId: input.recipientId as string, deliveryMethod: deliveryMethod as GenerationRequest["deliveryMethod"] };
}

function failure(error: unknown): Response {
  if (error instanceof DocumentError) {
    return Response.json({ error: error.message, code: error.code, fields: error.fields }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "Unable to generate or load the draft. Try again.", code: "crm_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

function checkQuery(error: unknown): void {
  if (error) throw new DocumentError(500, "crm_error", "Unable to read or save CRM data. Try again.");
}

export function createDocumentHandlers(authorize: (request: Request) => Promise<AuthorizedContext> = authorizeDocumentRequest) {
  return {
    async GET(request: Request): Promise<Response> {
      try {
        const { supabase, firmId } = await authorize(request);
        const { data: matters, error: matterError } = await supabase.from("matters").select("id, client_id, case_name, case_number").eq("firm_id", firmId).order("case_name");
        checkQuery(matterError);
        const { data: templates, error: templateError } = await supabase.from("templates").select("id, name, pleading_type").eq("firm_id", firmId).order("name");
        checkQuery(templateError);
        const matterRows = matters ?? [];
        let links: { matter_id: string; contact_id: string; relationship: string }[] = [];
        if (matterRows.length) {
          const result = await supabase.from("matter_contacts").select("matter_id, contact_id, relationship").in("matter_id", matterRows.map(matter => matter.id));
          checkQuery(result.error);
          links = result.data ?? [];
        }
        const contactIds = [...new Set([...links.map(link => link.contact_id), ...matterRows.map(matter => matter.client_id).filter(Boolean)])];
        let contacts: { id: string; full_name: string }[] = [];
        if (contactIds.length) {
          const result = await supabase.from("contacts").select("id, full_name").eq("firm_id", firmId).in("id", contactIds).order("full_name");
          checkQuery(result.error);
          contacts = result.data ?? [];
        }
        const options: GenerationOptions = {
          templates: templates ?? [],
          matters: matterRows.map(matter => ({
            id: matter.id, case_name: matter.case_name, case_number: matter.case_number,
            recipients: contacts.filter(contact => contact.id === matter.client_id || links.some(link => link.matter_id === matter.id && link.contact_id === contact.id)).map(contact => ({
              ...contact, relationship: links.find(link => link.matter_id === matter.id && link.contact_id === contact.id)?.relationship ?? "client",
            })),
          })),
        };
        return Response.json(options, { headers: { "Cache-Control": "no-store" } });
      } catch (error) { return failure(error); }
    },

    async POST(request: Request): Promise<Response> {
      try {
        const { supabase, firmId, author } = await authorize(request);
        let raw: unknown;
        try { raw = await request.json(); }
        catch { throw new DocumentError(400, "invalid_request", "Send a valid JSON generation request."); }
        const input = validateGenerationRequest(raw);

        const { data: matter, error: matterError } = await supabase.from("matters").select(matterColumns).eq("id", input.matterId).eq("firm_id", firmId).maybeSingle();
        checkQuery(matterError);
        if (!matter) throw new DocumentError(404, "not_found", "The selected matter is not available.");
        const { data: recipient, error: recipientError } = await supabase.from("contacts").select(contactColumns).eq("id", input.recipientId).eq("firm_id", firmId).maybeSingle();
        checkQuery(recipientError);
        if (!recipient) throw new DocumentError(404, "not_found", "The selected recipient is not available for this matter.");
        if (recipient.id !== matter.client_id) {
          const { data: link, error: linkError } = await supabase.from("matter_contacts").select("contact_id").eq("matter_id", matter.id).eq("contact_id", recipient.id).maybeSingle();
          checkQuery(linkError);
          if (!link) throw new DocumentError(404, "not_found", "The selected recipient is not available for this matter.");
        }
        const { data: template, error: templateError } = await supabase.from("templates").select("id, firm_id, name, pleading_type, body, ordering_rules").eq("id", input.templateId).eq("firm_id", firmId).maybeSingle();
        checkQuery(templateError);
        if (!template) throw new DocumentError(404, "not_found", "The selected template is not available.");
        if (typeof template.pleading_type !== "string" || !template.pleading_type.trim()) throw new DocumentError(422, "invalid_template", "The selected template needs a pleading type.");

        let client: ContactRecord | null = null;
        if (matter.client_id) {
          if (matter.client_id === recipient.id) client = recipient as ContactRecord;
          else {
            const result = await supabase.from("contacts").select(contactColumns).eq("id", matter.client_id).eq("firm_id", firmId).maybeSingle();
            checkQuery(result.error);
            client = result.data as ContactRecord | null;
            if (!client) throw new DocumentError(422, "missing_data", "The matter's client is unavailable. Update the CRM before generating a draft.", ["client"]);
          }
        }
        const { data: firm, error: firmError } = await supabase.from("firms").select("name").eq("id", firmId).maybeSingle();
        checkQuery(firmError);
        if (!firm) throw new DocumentError(403, "forbidden", "Your firm is unavailable.");

        const renderedBody = renderDocument(template as TemplateRecord, { matter: matter as MatterRecord, client, recipient: recipient as ContactRecord, firm, author });
        const { data: draft, error: insertError } = await supabase.from("documents").insert({
          matter_id: matter.id,
          template_id: template.id,
          recipient_id: recipient.id,
          pleading_type: template.pleading_type,
          rendered_body: renderedBody,
          delivery_method: input.deliveryMethod,
          status: "draft",
        }).select(draftColumns).single();
        checkQuery(insertError);
        if (!draft) throw new DocumentError(500, "crm_error", "The draft could not be saved. Try again.");
        return Response.json(draft, { status: 201, headers: { "Cache-Control": "no-store" } });
      } catch (error) { return failure(error); }
    },
  };
}
