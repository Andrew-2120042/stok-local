-- Increase pg_net timeout to 30s — OpenAI embedding calls average 2-4s
-- but can spike under load. 5s default was causing silent failures.
-- Settings come from the database (see 00010); superseded by 00022.
create or replace function trigger_generate_embedding()
returns trigger as $$
begin
  perform net.http_post(
    url := current_setting('app.supabase_functions_url', true) || '/generate-embedding',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.service_role_key', true), '')
    ),
    body := jsonb_build_object('record', row_to_json(new)),
    timeout_milliseconds := 30000
  );
  return new;
end;
$$ language plpgsql security definer;
