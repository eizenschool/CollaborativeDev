// Isolated real PostgreSQL/WASM smoke tests. No network/database credentials.
// npm install --prefix m2-test-runtime.local --no-save --package-lock=false @electric-sql/pglite
import { PGlite } from '../m2-test-runtime.local/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const original = await readFile('database/sql/028_m2_route_schedule_and_completion.sql','utf8');
const persister = original.match(/create or replace function public.persist_quoted_ride\([\s\S]*?\n\$\$;/)[0];
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema private; create schema extensions; create schema storage;
create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
create function extensions.digest(text,text) returns bytea language sql as 'select sha256(convert_to($1,''UTF8''))';
create table public.profiles(id uuid primary key);
create table public.vehicles(id uuid primary key, owner_id uuid, seats integer);
create table public.rides(
 id uuid primary key default gen_random_uuid(), host_id uuid, vehicle_id uuid,
 status text, pickup text, destination text, departure_at timestamptz, journey_scale text,
 seats_total integer, seats_available integer, contribution text default '', pickup_instructions text default '', pickup_photo_path text,
 restriction_tags text[],waypoints jsonb default '[]',updated_at timestamptz default now(),
 pickup_place_id text,pickup_latitude double precision,pickup_longitude double precision,destination_place_id text,
 published_at timestamptz,route_distance_meters integer,route_duration_seconds integer,route_stopover_seconds integer,
 estimated_arrival_at timestamptz,schedule_buffer_until timestamptz,route_quoted_at timestamptz,route_quote_expires_at timestamptz,route_quote_id uuid
);
create table public.ride_requests(id uuid default gen_random_uuid(),ride_id uuid,status text);
create function public.test_touch_ride() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end;$$;
create trigger touch_ride before update on public.rides for each row execute function public.test_touch_ride();
create table storage.objects(id uuid default gen_random_uuid(),name text,bucket_id text,created_at timestamptz default now());
alter table storage.objects enable row level security;
create policy permissive_upload on storage.objects for insert to authenticated with check(true);
grant usage on schema storage to authenticated; grant insert on storage.objects to authenticated;
create table private.m2_ride_verification(ride_id uuid primary key,pickup_anchor_latitude double precision,pickup_anchor_longitude double precision,
 destination_anchor_latitude double precision,destination_anchor_longitude double precision,driver_arrived_at timestamptz,
 driver_arrival_distance_meters double precision,passenger_confirmation_due_at timestamptz,completed_at timestamptz);
-- Only unrelated route helper dependencies are stubs. The real persist_quoted_ride
-- body and the entire new migration run unchanged below.
create function private.m2_validate_waypoints(jsonb,boolean) returns void language sql as 'select';
create function private.m2_assert_schedule_available(uuid,timestamptz,timestamptz,uuid,boolean) returns void language sql as 'select';
create function public.set_ride_pickup_photo(uuid,text) returns text language sql as 'select $2';
`);
await db.exec(persister);
// Match the already deployed service-only persistence boundary.
await db.exec(`revoke all on function public.persist_quoted_ride(uuid,text,uuid,uuid,text,text,timestamptz,text,integer,text,double precision,double precision,text,text,text,text[],jsonb,uuid,timestamptz,timestamptz,integer,integer,integer,timestamptz,double precision,double precision,double precision,double precision) from public,anon,authenticated;`);
await db.exec(await readFile('database/sql/114_m2_content_moderation.sql','utf8'));
let checked = 0;
async function rejects(sql, params, pattern) {
  await assert.rejects(db.query(sql, params), pattern); checked++;
}
const host='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const ride='00000000-0000-4000-8000-000000000003', vehicle='00000000-0000-4000-8000-000000000004';
await db.query('insert into profiles values($1),($2)',[host,other]);
await db.query('insert into vehicles values($1,$2,4)',[vehicle,host]);
await db.query("insert into rides(id,host_id,status) values($1,$2,'Draft')",[ride,host]);
await rejects("update rides set status='Published' where id=$1",[ride],/CONTENT_APPROVAL_REQUIRED/);
await db.exec('set role authenticated');
await rejects("insert into storage.objects(name,bucket_id) values('malicious.jpg','ride-pickup-photos')",[],/row-level security/);
await rejects("insert into m2_content_approvals default values",[],/permission denied/);
await rejects("select public.persist_moderated_ride('{}',null)",[],/permission denied/);
await rejects("select public.set_ride_pickup_photo($1,'malicious.jpg')",[ride],/permission denied/);
await db.exec('reset role');
async function receipt({ owner=host, contribution='Snacks', instructions='Gate A', photo=null }={}) {
  return (await db.query(`insert into m2_content_approvals(ride_id,host_id,contribution_digest,instructions_digest,photo_path,base_updated_at,policy_version)
  select id,$2,encode(extensions.digest($3,'sha256'),'hex'),encode(extensions.digest($4,'sha256'),'hex'),$5,updated_at,'m2-content-v4' from rides where id=$1 returning id`,[ride,owner,contribution,instructions,photo])).rows[0].id;
}
function args(mode='publish_draft') {
  const now=Date.now(), departure=now+86400000;
  return { p_host_id:host,p_mode:mode,p_ride_id:ride,p_vehicle_id:vehicle,p_pickup:'A',p_destination:'B',p_departure_at:new Date(departure).toISOString(),
    p_journey_scale:'Urban',p_seats_total:3,p_pickup_place_id:'place-a',p_destination_place_id:'place-b',p_pickup_instructions:'Gate A',p_contribution:'Snacks',p_restriction_tags:[],p_waypoints:[],
    p_route_quote_id:crypto.randomUUID(),p_route_quoted_at:new Date(now).toISOString(),p_route_quote_expires_at:new Date(now+240000).toISOString(),
    p_route_distance_meters:1000,p_route_duration_seconds:600,p_route_stopover_seconds:0,p_estimated_arrival_at:new Date(departure+600000).toISOString(),
    p_pickup_anchor_latitude:3,p_pickup_anchor_longitude:101,p_destination_anchor_latitude:3.1,p_destination_anchor_longitude:101.1 };
}
const sql='select persist_moderated_ride($1::jsonb,$2::uuid)';
await rejects(sql,[JSON.stringify(args()),await receipt({owner:other})],/CONTENT_APPROVAL_STALE/);
let approval=await receipt();
await rejects(sql,[JSON.stringify({...args(),p_contribution:'Unreviewed replacement'}),approval],/CONTENT_APPROVAL_REQUIRED/);
await db.query("update rides set updated_at=updated_at+interval '1 second' where id=$1",[ride]);
await rejects(sql,[JSON.stringify(args()),approval],/CONTENT_APPROVAL_STALE/);
approval=await receipt();
await db.query("update m2_content_approvals set expires_at=now()-interval '1 second' where id=$1",[approval]);
await rejects(sql,[JSON.stringify(args()),approval],/CONTENT_APPROVAL_STALE/);
approval=await receipt();
const competingApproval=await receipt();
await db.query("insert into ride_requests(ride_id,status) values($1,'Accepted')",[ride]);
await rejects(sql,[JSON.stringify(args()),approval],/accepted requests/);
await db.query('delete from ride_requests where ride_id=$1',[ride]);
await db.query(sql,[JSON.stringify(args()),approval]); checked++;
await rejects(sql,[JSON.stringify(args('update')),competingApproval],/CONTENT_APPROVAL_STALE/);
assert.equal((await db.query('select status from rides where id=$1',[ride])).rows[0].status,'Published');
// Expired approval does not block lifecycle transitions / returning from Matched.
await db.query("update m2_content_approvals set expires_at=now()-interval '1 second'",[]);
await db.query("update rides set status='Matched' where id=$1",[ride]);
await db.query("update rides set status='Published' where id=$1",[ride]); checked++;
const path=`${host}/${ride}/00000000-0000-4000-8000-000000000005.jpg`;
approval=await receipt({photo:path});
await rejects(sql,[JSON.stringify(args('update')),approval],/PHOTO_APPROVAL_REQUIRED/);
assert.equal((await db.query('select pickup_photo_path from rides where id=$1',[ride])).rows[0].pickup_photo_path,null);
await db.query("insert into storage.objects(name,bucket_id) values($1,'ride-pickup-photos')",[path]);
await db.query("insert into m2_moderated_photos(path,ride_id,host_id,digest,policy_version) values($1,$2,$3,repeat('a',64),'m2-content-v4')",[path,ride,host]);
await db.query(sql,[JSON.stringify(args('update')),approval]); checked++;
await rejects("update rides set pickup_photo_path='replacement.jpg' where id=$1",[ride],/CONTENT_APPROVAL_REQUIRED/);
await rejects("select bind_m2_draft_photo($1,$2,null)",[host,ride],/Draft/);
await db.query("update m2_moderated_photos set created_at=now()-interval '2 days'",[]);
assert.equal((await db.query('select * from claim_m2_unused_photos()')).rows.length,0); checked++;
console.log(`PASS: ${checked} PostgreSQL moderation checks (real persister; route helper stubs).`);
await db.close();
