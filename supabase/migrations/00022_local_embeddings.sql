-- Local embedding mode — lets the whole stack run with no OpenAI key.
--
-- local_embedding() is a deterministic "hashing trick" embedding: every word
-- and every character trigram of each word is hashed (md5) to one of 1536
-- dimensions with a ±1 sign, then the vector is L2-normalised. It captures
-- lexical/fuzzy similarity (earbud ≈ earbuds), not deep semantics, which is
-- enough for the hybrid search to work end to end. The API implements the
-- identical algorithm in apps/api/src/lib/embeddings.ts for query vectors —
-- the two MUST stay in sync.
--
-- The embedding provider is chosen per database:
--   local  (default)  embedding computed synchronously here, in the trigger
--   openai            pg_net → generate-embedding edge function, configured with
--                       alter database postgres set app.embedding_provider = 'openai';
--                       alter database postgres set app.supabase_functions_url = 'https://<ref>.supabase.co/functions/v1';
--                       alter database postgres set app.service_role_key = '<service role key>';
-- The API's EMBEDDING_PROVIDER env var must match.

create or replace function local_embedding(input text)
returns vector
language plpgsql
immutable
as $$
declare
  dims constant int := 1536;
  v float8[] := array_fill(0::float8, array[dims]);
  tok text;
  padded text;
  h text;
  idx int;
  i int;
  norm float8;
begin
  for tok in
    select t from regexp_split_to_table(lower(coalesce(input, '')), '[^a-z0-9]+') as t where t <> ''
  loop
    -- whole word, weight 2
    h := md5('w:' || tok);
    idx := (('x' || substr(h, 1, 8))::bit(32)::bigint % dims)::int + 1;
    v[idx] := v[idx] + case when ('x' || substr(h, 9, 1))::bit(4)::int < 8 then 2 else -2 end;

    -- character trigrams of '#word#', weight 1
    padded := '#' || tok || '#';
    for i in 1 .. length(padded) - 2 loop
      h := md5('g:' || substr(padded, i, 3));
      idx := (('x' || substr(h, 1, 8))::bit(32)::bigint % dims)::int + 1;
      v[idx] := v[idx] + case when ('x' || substr(h, 9, 1))::bit(4)::int < 8 then 1 else -1 end;
    end loop;
  end loop;

  select sqrt(sum(x * x)) into norm from unnest(v) as x;
  if norm = 0 then
    v[1] := 1;  -- avoid a zero vector (cosine distance would be NaN)
  else
    select array_agg(x / norm order by ord) into v from unnest(v) with ordinality as u(x, ord);
  end if;
  return v::vector;
end;
$$;

-- Same text the API / edge function embed: name, brand, category, description, specs.
create or replace function product_embedding_text(p products)
returns text
language sql
stable
as $$
  select concat_ws(' ', p.name, p.brand, p.category, p.description,
    (select string_agg(key || ': ' || value, ', ') from jsonb_each_text(coalesce(p.specs, '{}'::jsonb))))
$$;

create or replace function trigger_generate_embedding()
returns trigger as $$
begin
  if coalesce(current_setting('app.embedding_provider', true), '') = 'openai' then
    perform net.http_post(
      url := current_setting('app.supabase_functions_url', true) || '/generate-embedding',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.service_role_key', true), '')
      ),
      body := jsonb_build_object('record', row_to_json(new)),
      timeout_milliseconds := 30000
    );
  else
    new.embedding := local_embedding(product_embedding_text(new));
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- BEFORE trigger so local mode can set NEW.embedding directly (no async round trip).
drop trigger if exists on_product_upsert on products;
create trigger on_product_upsert
  before insert or update of name, brand, category, description, specs
  on products
  for each row
  execute function trigger_generate_embedding();
