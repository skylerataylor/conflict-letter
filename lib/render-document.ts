import { DocumentError } from "./document-errors";
import type { ContactRecord, MatterRecord, TemplateRecord } from "./document-types";

export type RenderContext = {
  matter: MatterRecord;
  client: ContactRecord | null;
  recipient: ContactRecord;
  firm: { name: string };
  author: { full_name: string };
};

const matterFields = ["case_name", "case_number", "court_name", "case_type", "status", "next_date"] as const;
const contactFields = ["full_name", "company", "email", "fax"] as const;
const addressFields = ["line1", "line2", "city", "state", "postal_code", "country"] as const;

function invalidTemplate(message: string): never {
  throw new DocumentError(422, "invalid_template", message);
}

function orderedBody(template: TemplateRecord): string {
  if (typeof template.body !== "string" || !template.body.trim()) {
    return invalidTemplate("The selected template has no body.");
  }
  const rules = template.ordering_rules;
  if (!Array.isArray(rules) || rules.some(rule => typeof rule !== "string" || !/^[a-z][a-z0-9_]*$/.test(rule))) {
    return invalidTemplate("Template ordering rules must be an array of section names.");
  }
  if (new Set(rules).size !== rules.length) {
    return invalidTemplate("Template ordering rules contain duplicate sections.");
  }

  const sections = new Map<string, string>();
  const outside = template.body.replace(/\{\{#section\s+([a-z][a-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/section\s*\}\}/g, (_match, name: string, content: string) => {
    if (sections.has(name)) invalidTemplate(`Template section ${name} is repeated.`);
    if (/\{\{\s*[#/]/.test(content)) invalidTemplate("Template sections cannot be nested.");
    sections.set(name, content.trim());
    return "";
  });

  if (sections.size) {
    if (outside.trim()) invalidTemplate("All template text must be inside named sections when sections are used.");
    if (rules.length && (rules.length !== sections.size || rules.some(rule => !sections.has(rule)))) {
      invalidTemplate("Template ordering rules must list every section exactly once.");
    }
    const order = rules.length ? rules : [...sections.keys()];
    return order.map(name => sections.get(name)).join("\n\n");
  }
  if (rules.length) invalidTemplate("Template ordering rules require named sections in the body.");
  return template.body;
}

function mergeFields(context: RenderContext): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  for (const field of matterFields) fields.set(`matter.${field}`, context.matter[field]);
  fields.set("firm.name", context.firm.name);
  fields.set("author.full_name", context.author.full_name);
  for (const [prefix, contact] of [["client", context.client], ["recipient", context.recipient]] as const) {
    for (const field of contactFields) fields.set(`${prefix}.${field}`, contact?.[field]);
    const address = contact?.address;
    for (const field of addressFields) {
      fields.set(`${prefix}.address.${field}`, address && typeof address === "object" && !Array.isArray(address) && Object.hasOwn(address, field)
        ? (address as Record<string, unknown>)[field] : undefined);
    }
  }
  return fields;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// Templates are plain text. No evaluation, recursive substitution, or arbitrary object paths.
export function renderDocument(template: TemplateRecord, context: RenderContext): string {
  const body = orderedBody(template);
  const fields = mergeFields(context);
  const tokens = [...body.matchAll(/\{\{([^{}]*)\}\}/g)];
  const literalText = body.replace(/\{\{([^{}]*)\}\}/g, "");
  if (body.includes("{{{") || body.includes("}}}") || literalText.includes("{{") || literalText.includes("}}")) {
    invalidTemplate("The template contains an incomplete merge field or section.");
  }
  const referenced = [...new Set(tokens.map(match => match[1].trim()))];
  const unsupported = referenced.filter(field => !fields.has(field));
  if (unsupported.length) {
    throw new DocumentError(422, "invalid_template", `Unsupported template fields: ${unsupported.join(", ")}.`, unsupported);
  }

  const missing: string[] = [];
  const invalid: string[] = [];
  for (const field of referenced) {
    const raw = fields.get(field);
    if (raw == null || (typeof raw === "string" && !raw.trim())) {
      missing.push(field);
      continue;
    }
    if (typeof raw !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
      invalid.push(field);
      continue;
    }
    const value = raw.trim();
    if ((field.endsWith(".email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || (field === "matter.next_date" && !validDate(value))) {
      invalid.push(field);
    }
  }
  if (invalid.length) {
    throw new DocumentError(422, "invalid_data", `Correct these CRM fields before generating a draft: ${invalid.join(", ")}.`, invalid);
  }
  if (missing.length) {
    throw new DocumentError(422, "missing_data", `Complete these CRM fields before generating a draft: ${missing.join(", ")}.`, missing);
  }

  const rendered = body.replace(/\{\{([^{}]*)\}\}/g, (_match, field: string) => (fields.get(field.trim()) as string).trim());
  if (!rendered.trim()) invalidTemplate("The selected template renders an empty draft.");
  return rendered;
}
