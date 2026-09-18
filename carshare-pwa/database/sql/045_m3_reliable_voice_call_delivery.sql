-- Module 3: durable incoming-call delivery for foreground and background PWAs.
-- The call row remains authoritative; this notification is a short-lived wake-up
-- hint and does not grant access to calls, conversations, or signalling topics.

begin;

create or replace function private.notify_incoming_voice_call()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_caller_name text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), 'A member')
  into v_caller_name
  from public.profiles p
  where p.id = new.caller_id;

  perform private.create_user_notification(
    new.callee_id,
    'm3',
    'voice_call',
    'Incoming call from ' || coalesce(v_caller_name, 'A member'),
    'Tap to answer this private voice call.',
    '/message/' || new.conversation_id::text,
    jsonb_build_object(
      'conversationId', new.conversation_id,
      'callId', new.id
    ),
    'voice-call:' || new.id::text
  );

  return new;
end;
$$;

revoke all on function private.notify_incoming_voice_call()
  from public, anon, authenticated;

drop trigger if exists notify_incoming_voice_call on public.call_sessions;
create trigger notify_incoming_voice_call
after insert on public.call_sessions
for each row
when (new.status = 'ringing')
execute function private.notify_incoming_voice_call();

commit;
