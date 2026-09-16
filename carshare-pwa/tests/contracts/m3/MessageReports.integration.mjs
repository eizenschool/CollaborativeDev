// Run with PGLITE_MODULE pointing at an installed @electric-sql/pglite module.
// In-memory Postgres: no production messages, identities or reputation are changed.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function private.is_identity_review_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false')='true' $$;
create table public.profiles(id uuid primary key, full_name text, status text default 'active');
create table public.rides(id uuid primary key);
create table public.conversations(id uuid primary key, ride_id uuid);
create table public.messages(id uuid primary key, sender_id uuid, conversation_id uuid, kind text default 'user', text_content text, created_at timestamptz default now(), edited_at timestamptz, deleted_at timestamptz);
create table public.message_attachments(id uuid primary key default gen_random_uuid(),message_id uuid,kind text,storage_path text,file_name text,mime_type text,file_size bigint,sort_order int default 0);
create table public.message_ride_invitations(message_id uuid);
create table public.host_impact_stats(user_id uuid primary key,reputation_score int default 100,reputation_hold boolean default false,reputation_updated_at timestamptz,updated_at timestamptz);
create table public.reputation_events(user_id uuid, event_type text, source_module text,source_event_id text,delta int,created_at timestamptz default now(),unique(user_id,source_event_id,event_type));
create function private.message_is_visible(p_id uuid,p_user uuid) returns boolean language sql stable as $$ select p_user is not null and coalesce(current_setting('test.visible',true),'true') <> 'false' and exists(select 1 from public.messages where id=p_id) $$;
create function private.record_reputation_event(p_user uuid,p_ride uuid,p_source text,p_key text,p_type text,p_role text,p_delta int,p_reason text,p_meta jsonb) returns boolean language plpgsql as $$ begin
insert into public.reputation_events(user_id,event_type,source_module,source_event_id,delta) values(p_user,p_type,p_source,p_key,p_delta) on conflict do nothing;
if not found then return false; end if;
update public.host_impact_stats set reputation_score=greatest(0,reputation_score+p_delta) where user_id=p_user;
return true; end $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(bucket_id text,name text);
`);
const intake = await readFile('database/sql/107_m1_safety_report_queue.sql','utf8');
await db.exec(intake);
const severity = await readFile('database/sql/104_m1_graduated_conduct_severity.sql','utf8');
await db.exec(severity.slice(severity.indexOf('create or replace function private.apply_conduct_outcome')));
const migration = await readFile('database/sql/109_m3_message_reports.sql','utf8');
await db.exec(migration.slice(0,migration.indexOf('-- Dedicated cleanup token')) + '\ncommit;');
// Reproduce the live regression: the older M1 queue definition omits the M3
// discriminator, then verify the compensating migration restores it.
const legacyQueue = await readFile('database/sql/108_m1_fix_safety_report_queue_order_by.sql','utf8');
await db.exec(legacyQueue);
const queueFix = await readFile('database/sql/111_m3_fix_message_report_admin_queue.sql','utf8');
await db.exec(queueFix);
const sender='00000000-0000-4000-8000-000000000001', viewer='00000000-0000-4000-8000-000000000002', viewer2='00000000-0000-4000-8000-000000000003';
const message='10000000-0000-4000-8000-000000000001';
await db.exec(`insert into profiles(id,full_name) values('${sender}','Sender'),('${viewer}','Viewer'),('${viewer2}','Viewer 2'); insert into host_impact_stats(user_id) values('${sender}'); insert into conversations(id) values('${message}'); insert into messages(id,sender_id,conversation_id,text_content) values('${message}','${sender}','${message}','Evidence text');`);
async function actor(id, admin=false) { await db.query("select set_config('test.uid',$1,false),set_config('test.admin',$2,false)",[id, String(admin)]); }
async function scalar(sql, args=[]) { return (await db.query(sql,args)).rows[0].value; }
async function prepare() { return scalar('select prepare_message_report($1,$2) as value',[message,'Harassment']); }
await actor(sender);
await assert.rejects(prepare, /cannot be reported/);
await actor(viewer);
await db.exec("select set_config('test.visible','false',false)");
await assert.rejects(prepare, /unavailable/);
await db.exec("select set_config('test.visible','true',false)");
const first=await prepare();
const finish=await scalar('select finish_message_report($1) as value',[first.attemptId]);
assert.equal((await prepare()).alreadyReported,true);
await actor(viewer2);
const second=await prepare();
assert.equal(second.existingEvidenceId,finish.evidenceId);
await scalar('select finish_message_report($1) as value',[second.attemptId]);
assert.equal(await scalar('select count(*)::int as value from message_report_evidence'),1);
assert.equal(await scalar('select count(*)::int as value from safety_reports'),2);
await assert.rejects(() => scalar('select admin_message_report_evidence($1) as value',[finish.evidenceId]),/Not authorized/);
await actor(viewer,true);
const queue=await scalar("select admin_list_safety_reports('open') as value");
assert.equal(queue.length,2); assert.equal(queue[0].messageEvidenceId,finish.evidenceId);
await assert.rejects(() => db.query("select admin_resolve_safety_report($1,'resolved','bypass')",[queue[0].id]),/evidence review/);
await db.exec(`update messages set text_content=null,deleted_at=now() where id='${message}'`);
assert.equal((await scalar('select admin_message_report_evidence($1) as value',[finish.evidenceId])).snapshot.text,'Evidence text');
await db.query("select admin_review_message_report($1,'confirmed_minor_conduct','Confirmed harassment',true)",[finish.evidenceId]);
await db.query("select admin_review_message_report($1,'confirmed_serious_conduct','Retry must not punish twice',true)",[finish.evidenceId]);
assert.equal(await scalar('select reputation_score as value from host_impact_stats'),92);
assert.equal(await scalar('select count(*)::int as value from reputation_events'),1);
assert.equal(await scalar("select count(*)::int as value from safety_reports where status='resolved'"),2);
// An edit between copy preparation and finalization cannot save mismatched evidence.
await db.exec(`update messages set text_content='New version',deleted_at=null,edited_at=now() where id='${message}'`);
await actor(viewer2);
const changed=await prepare();
await db.exec(`update messages set text_content='Changed again' where id='${message}'`);
await assert.rejects(() => db.query('select finish_message_report($1)',[changed.attemptId]),/changed or became unavailable/);
// Incomplete media copies never become a report; complete private copies survive removal.
await db.exec(`insert into message_attachments(message_id,kind,storage_path,file_name,mime_type,file_size) values('${message}','audio','original/voice.wav','voice.wav','audio/wav',100);`);
await actor(viewer);
const media=await prepare();
await assert.rejects(() => db.query('select finish_message_report($1)',[media.attemptId]),/Evidence is incomplete/);
await db.query("insert into storage.objects values('message-report-evidence',$1)",[media.attemptId+'/0']);
await db.query('select finish_message_report($1)',[media.attemptId]);
await actor(viewer,true);
await db.query("select admin_review_message_report($1,'warning','Remove harmful voice message',true)",[media.attemptId]);
assert.equal(await scalar('select count(*)::int as value from message_attachments'),0);
assert.equal(await scalar('select moderated_at is not null as value from messages'),true);
assert.equal((await scalar('select admin_message_report_evidence($1) as value',[media.attemptId])).snapshot.attachments.length,1);
assert.equal(await scalar('select reputation_score as value from host_impact_stats'),92);
assert.equal(await scalar("select has_function_privilege('authenticated','finish_message_report(uuid)','EXECUTE') as value"),false);
assert.equal(await scalar("select has_table_privilege('authenticated','message_report_evidence','SELECT') as value"),false);
console.log('Postgres integration checks passed: authorization, queue, immutable evidence, media completeness, deletion, duplicate reports and once-only penalties.');
await db.close();
