"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { DeliveryMethod, DocumentDraft, GenerationOptions } from "@/lib/document-types";

class SignInRequired extends Error {}

async function crmRequest(init?: RequestInit): Promise<Response> {
  const client = createClient();
  if (!client) throw new Error("Document generation is unavailable until your firm connects its CRM.");
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session) throw new SignInRequired("Sign in to load your firm's matters and templates.");
  const response = await fetch("/api/documents", {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
  });
  if (response.status === 401) throw new SignInRequired("Your session has expired. Sign in again.");
  return response;
}

export default function PleadingGenerator({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState<GenerationOptions | null>(null);
  const [matterId, setMatterId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("email");
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reload, setReload] = useState(0);
  const matter = options?.matters.find(item => item.id === matterId);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError("");
    setOptions(null);
    setDraft(null);
    async function load() {
      try {
        const response = await crmRequest({ signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load your CRM selections.");
        if (cancelled) return;
        const loaded = data as GenerationOptions;
        setOptions(loaded);
        setMatterId(loaded.matters[0]?.id ?? "");
        setRecipientId(loaded.matters[0]?.recipients[0]?.id ?? "");
        setTemplateId(loaded.templates[0]?.id ?? "");
        setNeedsSignIn(false);
      } catch (cause) {
        if (cancelled) return;
        setNeedsSignIn(cause instanceof SignInRequired);
        setError(cause instanceof Error ? cause.message : "Unable to load your CRM selections.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [reload]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const client = createClient();
      if (!client) throw new Error("Your firm needs to connect its CRM.");
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error("Unable to sign in. Check your email and password.");
      setPassword("");
      setReload(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Try again.");
    } finally { setBusy(false); }
  }

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !matterId || !templateId || !recipientId) return;
    setBusy(true);
    setError("");
    setDraft(null);
    try {
      const response = await crmRequest({ method: "POST", body: JSON.stringify({ matterId, templateId, recipientId, deliveryMethod }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create the draft. Try again.");
      if (data.status !== "draft" || typeof data.rendered_body !== "string" || !data.rendered_body.trim()) {
        throw new Error("The server did not return a reviewable draft. Try again.");
      }
      setDraft(data as DocumentDraft);
    } catch (cause) {
      if (cause instanceof SignInRequired) {
        setNeedsSignIn(true);
        setOptions(null);
      }
      setError(cause instanceof Error ? cause.message : "Unable to create the draft. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return <div className="overlay" onMouseDown={() => { if (!busy) onClose(); }}>
    <div className={`modal${draft ? " reviewmodal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="generator-title" onMouseDown={event => event.stopPropagation()}>
      <button className="close" aria-label="Close generator" disabled={busy} onClick={onClose}><X /></button>
      <div className="modalicon"><Sparkles /></div>
      <p className="eyebrow">DOCUMENT AUTOMATION</p>
      <h2 id="generator-title">{draft ? "Review your draft" : "Generate a new pleading"}</h2>
      <p>{draft ? "Your draft is saved. Review the full text before arranging delivery." : "Populate your firm's template with matter and contact data from the CRM."}</p>
      {error && <p className="formerror" role="alert">{error}</p>}
      {loading && <p role="status">Loading your firm's matters and templates…</p>}
      {!loading && needsSignIn && <form onSubmit={signIn}>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <button className="generate" disabled={busy}>{busy ? "Signing in…" : "Sign in to your CRM"}</button>
      </form>}
      {!loading && !needsSignIn && !options && <button className="generate" onClick={() => setReload(value => value + 1)}>Retry loading CRM</button>}
      {!loading && options && !draft && <form onSubmit={generate}>
        <label>Matter<select value={matterId} disabled={busy} onChange={event => {
          const id = event.target.value;
          setMatterId(id);
          setRecipientId(options.matters.find(item => item.id === id)?.recipients[0]?.id ?? "");
          setError("");
        }}><option value="" disabled>Select a matter</option>{options.matters.map(item => <option value={item.id} key={item.id}>{item.case_name} · {item.case_number}</option>)}</select></label>
        <label>Template<select value={templateId} disabled={busy} onChange={event => { setTemplateId(event.target.value); setError(""); }}><option value="" disabled>Select a template</option>{options.templates.map(item => <option value={item.id} key={item.id}>{item.name} · {item.pleading_type}</option>)}</select></label>
        <label>Recipient<select value={recipientId} disabled={busy} onChange={event => { setRecipientId(event.target.value); setError(""); }}><option value="" disabled>Select a recipient</option>{matter?.recipients.map(item => <option value={item.id} key={item.id}>{item.full_name} · {item.relationship}</option>)}</select></label>
        <label>Delivery preference<select value={deliveryMethod} disabled={busy} onChange={event => setDeliveryMethod(event.target.value as DeliveryMethod)}><option value="email">Email</option><option value="fax">Fax</option><option value="both">Email and fax</option></select></label>
        <div className="rule"><Check size={17} /><span><b>Draft for review</b><small>The template's merge fields and section order will be validated. Generating a preview saves a draft without sending it.</small></span></div>
        {!options.matters.length && <p className="selectionhelp">Add a matter to your firm's CRM to generate a draft.</p>}
        {!options.templates.length && <p className="selectionhelp">Add a pleading template to your firm's CRM to generate a draft.</p>}
        {matter && !matter.recipients.length && <p className="selectionhelp">Link a recipient to this matter in the CRM.</p>}
        <button className="generate" disabled={busy || !matterId || !templateId || !recipientId}><Sparkles size={17} />{busy ? "Building and saving draft…" : "Build document preview"}</button>
      </form>}
      {draft && <>
        <div className="draftstatus" role="status"><Check size={17} />Draft saved · Not sent</div>
        <h3 className="drafttitle">{draft.pleading_type}</h3>
        <pre className="documentpreview" aria-label="Rendered draft">{draft.rendered_body}</pre>
        <div className="reviewactions"><button className="secondary" onClick={() => { setDraft(null); setError(""); }}>Back to selections</button><button className="generate" onClick={onClose}>Close preview</button></div>
      </>}
    </div>
  </div>;
}
