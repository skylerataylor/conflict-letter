import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const payload = await request.json();
  const required = ["matterId", "pleadingType", "recipient"];
  const missing = required.filter((key) => !payload[key]);
  if (missing.length) return NextResponse.json({ error: `Missing ${missing.join(", ")}` }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const supabase = createClient(url, key);
    const recipientId = /^[0-9a-f-]{36}$/i.test(payload.recipient) ? payload.recipient : null;
    const { data, error } = await supabase.from("documents").insert({ matter_id: payload.matterId, pleading_type: payload.pleadingType, recipient_id: recipientId, delivery_method: payload.deliveryMethod ?? "email", status: "draft" }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }
  return NextResponse.json({ id: crypto.randomUUID(), status: "draft", preview: true }, { status: 201 });
}
