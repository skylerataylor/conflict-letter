# LexFlow

A Next.js legal practice workspace for CRM-backed pleading generation and email/fax delivery. The interface runs with representative preview data until Supabase credentials are configured.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and add Supabase credentials.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. `npm run dev`

The Node-powered route at `POST /api/documents` validates generation requests and persists drafts through the Supabase service role. `POST /api/deliveries` queues email through Resend and supports a configurable JSON fax provider endpoint when environment credentials are present; without credentials it safely returns a preview response.
