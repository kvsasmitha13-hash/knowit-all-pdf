create extension if not exists vector;

create table public.pdf_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  page_count int not null default 0,
  chunk_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.pdf_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.pdf_documents(id) on delete cascade,
  chunk_index int not null,
  page int,
  content text not null,
  embedding vector(3072) not null,
  created_at timestamptz not null default now()
);

create index pdf_chunks_document_id_idx on public.pdf_chunks (document_id);
create index pdf_chunks_embedding_idx
  on public.pdf_chunks using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

GRANT ALL ON public.pdf_documents TO service_role;
GRANT ALL ON public.pdf_chunks TO service_role;

alter table public.pdf_documents enable row level security;
alter table public.pdf_chunks enable row level security;

create or replace function public.match_pdf_chunks (
  p_document_id uuid,
  query_embedding vector(3072),
  match_count int default 5
)
returns table (
  id uuid,
  chunk_index int,
  page int,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.chunk_index,
    c.page,
    c.content,
    1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.pdf_chunks c
  where c.document_id = p_document_id
  order by c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$$;

revoke all on function public.match_pdf_chunks(uuid, vector, int) from anon, authenticated;
grant execute on function public.match_pdf_chunks(uuid, vector, int) to service_role;
