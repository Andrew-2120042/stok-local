-- Replace the trigger function. The functions URL and service role key are
-- read from database settings (never hardcoded in the repo):
--   alter database postgres set app.supabase_functions_url = 'https://<ref>.supabase.co/functions/v1';
--   alter database postgres set app.service_role_key = '<service role key>';
-- Superseded by 00022, which adds the local (no-OpenAI) embedding mode.
create or replace function trigger_generate_embedding()
returns trigger as $$
begin
  perform net.http_post(
    url := current_setting('app.supabase_functions_url', true) || '/generate-embedding',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.service_role_key', true), '')
    ),
    body := jsonb_build_object('record', row_to_json(new))
  );
  return new;
end;
$$ language plpgsql security definer;
