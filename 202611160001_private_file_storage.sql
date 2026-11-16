insert into storage.buckets (id, name, public)
values ('bird-files', 'bird-files', false)
on conflict (id) do update set public = false;

drop policy if exists "Bird files: read own" on storage.objects;
create policy "Bird files: read own"
on storage.objects for select to authenticated
using (
  bucket_id = 'bird-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Bird files: upload own" on storage.objects;
create policy "Bird files: upload own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'bird-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Bird files: edit own" on storage.objects;
create policy "Bird files: edit own"
on storage.objects for update to authenticated
using (
  bucket_id = 'bird-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'bird-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);