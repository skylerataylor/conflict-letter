import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { method, to, subject, html, mediaUrl } = await request.json();
  if (!method || !to) return NextResponse.json({ error: "A delivery method and recipient are required." }, { status: 400 });
  if ((method === "email" || method === "both") && process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "pleadings@yourfirm.com", to, subject: subject ?? "Legal correspondence", html }) });
    if (!response.ok) return NextResponse.json({ error: "Email provider rejected the delivery." }, { status: 502 });
  }
  if ((method === "fax" || method === "both") && process.env.FAX_API_URL && process.env.FAX_API_TOKEN) {
    const response = await fetch(process.env.FAX_API_URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.FAX_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ to, mediaUrl }) });
    if (!response.ok) return NextResponse.json({ error: "Fax provider rejected the delivery." }, { status: 502 });
  }
  return NextResponse.json({ status: "queued", preview: !process.env.RESEND_API_KEY && !process.env.FAX_API_URL });
}
