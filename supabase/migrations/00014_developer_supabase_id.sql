alter table developers add column if not exists supabase_user_id text unique;
create index if not exists developers_supabase_user_id_idx on developers(supabase_user_id);
