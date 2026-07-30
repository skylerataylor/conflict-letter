-- Run in the Supabase SQL editor. Row-level security keeps each firm's data isolated.
create extension if not exists "uuid-ossp";
create table firms (id uuid primary key default uuid_generate_v4(), name text not null, created_at timestamptz default now());
create table profiles (id uuid primary key references auth.users on delete cascade, firm_id uuid not null references firms, full_name text not null, role text default 'member');
create table contacts (id uuid primary key default uuid_generate_v4(), firm_id uuid not null references firms, kind text not null check(kind in ('client','attorney','court','other')), full_name text not null, company text, email text, fax text, address jsonb default '{}'::jsonb, created_at timestamptz default now());
create table matters (id uuid primary key default uuid_generate_v4(), firm_id uuid not null references firms, client_id uuid references contacts, case_name text not null, case_number text not null, court_name text not null, case_type text not null, status text default 'active', next_date date, created_at timestamptz default now());
create table matter_contacts (matter_id uuid references matters on delete cascade, contact_id uuid references contacts on delete cascade, relationship text not null, primary key(matter_id,contact_id));
create table templates (id uuid primary key default uuid_generate_v4(), firm_id uuid not null references firms, name text not null, pleading_type text not null, body text not null, ordering_rules jsonb default '[]'::jsonb, created_at timestamptz default now());
create table documents (id uuid primary key default uuid_generate_v4(), matter_id uuid not null references matters, template_id uuid references templates, recipient_id uuid references contacts, pleading_type text not null, rendered_body text, delivery_method text check(delivery_method in ('email','fax','both')), status text default 'draft', created_at timestamptz default now());
alter table firms enable row level security; alter table profiles enable row level security; alter table contacts enable row level security; alter table matters enable row level security; alter table matter_contacts enable row level security; alter table templates enable row level security; alter table documents enable row level security;
create or replace function current_firm_id() returns uuid language sql stable security definer set search_path=public as $$ select firm_id from profiles where id=auth.uid() $$;
create policy "firm contacts" on contacts for all using (firm_id=current_firm_id()) with check (firm_id=current_firm_id());
create policy "firm matters" on matters for all using (firm_id=current_firm_id()) with check (firm_id=current_firm_id());
create policy "firm templates" on templates for all using (firm_id=current_firm_id()) with check (firm_id=current_firm_id());
create policy "firm profile members" on profiles for select using (firm_id=current_firm_id());
create policy "firm record" on firms for select using (id=current_firm_id());
create policy "firm matter contacts" on matter_contacts for all using (exists(select 1 from matters where matters.id=matter_contacts.matter_id and matters.firm_id=current_firm_id()));
create policy "matter documents" on documents for all using (exists(select 1 from matters where matters.id=documents.matter_id and matters.firm_id=current_firm_id()));
