import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRecord, MatterRecord, TemplateRecord } from "../lib/document-types";
import type { RenderContext } from "../lib/render-document";

export const ids = {
  firm: "11111111-1111-4111-8111-111111111111",
  matter: "22222222-2222-4222-8222-222222222222",
  client: "33333333-3333-4333-8333-333333333333",
  recipient: "44444444-4444-4444-8444-444444444444",
  template: "55555555-5555-4555-8555-555555555555",
  otherFirm: "66666666-6666-4666-8666-666666666666",
  otherMatter: "77777777-7777-4777-8777-777777777777",
  otherContact: "88888888-8888-4888-8888-888888888888",
};

export const client: ContactRecord = {
  id: ids.client, firm_id: ids.firm, full_name: "Jordan Taylor", company: null,
  email: "jordan@example.test", fax: null,
  address: { line1: "1 Main Street", city: "Fayetteville", state: "GA", postal_code: "30214" },
};
export const recipient: ContactRecord = {
  id: ids.recipient, firm_id: ids.firm, full_name: "Morgan Counsel", company: "Counsel LLP",
  email: "morgan@example.test", fax: "+1 770 555 0100", address: { line1: "2 Court Street", city: "Atlanta", state: "GA", postal_code: "30303" },
};
export const matter: MatterRecord = {
  id: ids.matter, firm_id: ids.firm, client_id: ids.client, case_name: "State v. Taylor",
  case_number: "2026-CR-123", court_name: "State Court of Fayette County", case_type: "Criminal",
  status: "active", next_date: "2026-10-20",
};
export const template: TemplateRecord = {
  id: ids.template, firm_id: ids.firm, name: "Firm appearance", pleading_type: "Notice of Appearance",
  body: "{{matter.court_name}}\n{{matter.case_name}}\nCase No. {{matter.case_number}}\n\nCounsel appears for {{client.full_name}}.\nServe {{recipient.full_name}} at {{recipient.email}}.\n{{author.full_name}}\n{{firm.name}}",
  ordering_rules: [],
};
export function renderContext(): RenderContext {
  return structuredClone({ matter, client, recipient, firm: { name: "Taylor Legal" }, author: { full_name: "Skyler Taylor" } });
}

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: unknown };
export type QueryLog = { table: string; columns: string; filters: [string, unknown][]; operation: "select" | "insert" };

// An in-memory PostgREST double: filters and projections execute rather than returning canned rows.
export class MemoryDatabase {
  tables: Record<string, Row[]> = {
    matters: [structuredClone(matter)],
    contacts: [structuredClone(client), structuredClone(recipient)],
    templates: [structuredClone(template)],
    matter_contacts: [{ matter_id: ids.matter, contact_id: ids.recipient, relationship: "opposing-counsel" }],
    firms: [{ id: ids.firm, name: "Taylor Legal" }],
    documents: [],
  };
  queries: QueryLog[] = [];
  failures = new Map<string, string>();
  asClient(): SupabaseClient { return this as unknown as SupabaseClient; }
  from(table: string) { return new MemoryQuery(this, table); }
}

class MemoryQuery {
  private columns = "*";
  private filters: [string, unknown][] = [];
  private insertion: Row | null = null;
  constructor(private db: MemoryDatabase, private table: string) {}
  select(columns: string) { this.columns = columns; return this; }
  eq(field: string, value: unknown) { this.filters.push([field, value]); return this; }
  in(field: string, values: unknown[]) { this.filters.push([field, values]); return this; }
  order(_field: string) { return this; }
  insert(row: Row) { this.insertion = row; return this; }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute(false).then(onfulfilled, onrejected);
  }
  private async execute(single: boolean): Promise<QueryResult> {
    const operation = this.insertion ? "insert" : "select";
    this.db.queries.push({ table: this.table, columns: this.columns, filters: this.filters, operation });
    const failure = this.db.failures.get(`${this.table}:${operation}`);
    if (failure) return { data: null, error: { message: failure } };
    if (this.insertion) {
      this.db.tables[this.table].push({ id: "99999999-9999-4999-8999-999999999999", created_at: "2026-10-04T14:30:00Z", ...this.insertion });
    }
    let rows = this.insertion ? this.db.tables[this.table].slice(-1) : this.db.tables[this.table].filter(row => this.filters.every(([field, value]) => Array.isArray(value) ? value.includes(row[field]) : row[field] === value));
    if (this.columns !== "*") {
      rows = rows.map(row => Object.fromEntries(this.columns.split(",").map(field => field.trim()).map(field => [field, row[field]])));
    }
    return { data: single ? rows[0] ?? null : rows, error: null };
  }
}
