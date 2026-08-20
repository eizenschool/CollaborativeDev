-- Module 3 four-language translation cache.
-- Cloudflare credentials remain Edge Function secrets; authenticated browser
-- clients can only read cached results for conversations they can still see.

create table public.message_translations (
  message_id uuid not null references public.messages(id) on delete cascade,
  target_language text not null,
  source_language text not null,
  source_kind text not null,
  source_version timestamptz not null,
  source_text text not null,
  transcript text,
  translated_text text not null,
  translation_model text not null,
  transcription_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, target_language),
  constraint message_translations_target_language_check
    check (target_language in ('en', 'zh', 'ms', 'ta')),
  constraint message_translations_source_language_check
    check (source_language in ('en', 'zh', 'ms', 'ta')),
  constraint message_translations_source_kind_check
    check (source_kind in ('text', 'audio')),
  constraint message_translations_source_text_check
    check (char_length(source_text) between 1 and 12000),
  constraint message_translations_transcript_check
    check (
      (source_kind = 'text' and transcript is null and transcription_model is null)
      or
      (source_kind = 'audio' and transcript is not null and transcription_model is not null)
    ),
  constraint message_translations_translated_text_check
    check (char_length(translated_text) between 1 and 20000)
);

comment on table public.message_translations is
  'Shared, source-versioned cache for member-requested text and voice-message translations.';
comment on column public.message_translations.source_version is
  'The message edited_at value, or created_at when unedited; mismatches make a cache row stale.';

alter table public.message_translations enable row level security;

create policy "members read visible message translations"
  on public.message_translations for select to authenticated
  using (
    exists (
      select 1
      from public.messages m
      where m.id = message_translations.message_id
        and m.deleted_at is null
        and (select private.conversation_is_visible(
          m.conversation_id,
          (select auth.uid())
        ))
    )
  );

revoke all on table public.message_translations from public, anon, authenticated;
grant select on table public.message_translations to authenticated;

