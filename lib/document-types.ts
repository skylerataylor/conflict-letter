export type DeliveryMethod = "email" | "fax" | "both";

export type ContactRecord = {
  id: string;
  firm_id: string;
  full_name: string;
  company: string | null;
  email: string | null;
  fax: string | null;
  address: unknown;
};

export type MatterRecord = {
  id: string;
  firm_id: string;
  client_id: string | null;
  case_name: string;
  case_number: string;
  court_name: string;
  case_type: string;
  status: string | null;
  next_date: string | null;
};

export type TemplateRecord = {
  id: string;
  firm_id: string;
  name: string;
  pleading_type: string;
  body: string;
  ordering_rules: unknown;
};

export type GenerationRequest = {
  matterId: string;
  templateId: string;
  recipientId: string;
  deliveryMethod: DeliveryMethod;
};

export type GenerationOptions = {
  matters: {
    id: string;
    case_name: string;
    case_number: string;
    recipients: { id: string; full_name: string; relationship: string }[];
  }[];
  templates: { id: string; name: string; pleading_type: string }[];
};

export type DocumentDraft = {
  id: string;
  matter_id: string;
  template_id: string;
  recipient_id: string;
  pleading_type: string;
  rendered_body: string;
  delivery_method: DeliveryMethod;
  status: "draft";
  created_at: string;
};
