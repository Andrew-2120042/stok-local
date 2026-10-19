-- Fires the generate-embedding edge function whenever a product's
-- text fields change, so the vector column stays in sync automatically.
create or replace function trigger_generate_embedding()
returns trigger as $$
begin
  perform net.http_post(
    url := current_setting('app.supabase_functions_url') || '/generate-embedding',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('record', row_to_json(new))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_product_upsert
  after insert or update of name, brand, description, specs
  on products
  for each row
  execute function trigger_generate_embedding();
