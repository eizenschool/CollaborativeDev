import { describe, expect, it } from 'vitest';

describe('Module 4 SQL contract', () => {
  it('keeps migration sequence numbers unique', async () => {
    const migrations = await import('node:fs/promises').then(({ readdir }) => readdir(
      new URL('../../../database/sql/', import.meta.url)
    ));
    const sequenceNumbers = migrations
      .map((fileName) => fileName.match(/^(\d{3})_.*\.sql$/)?.[1])
      .filter(Boolean);

    expect(new Set(sequenceNumbers).size).toBe(sequenceNumbers.length);
  });

  it('locks favourites to authenticated owners and returns only safe ride-card fields', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/027_m4_smart_search_favourites.sql', import.meta.url),
      'utf8'
    ));
    expect(sql).toContain('alter table public.ride_favourites enable row level security');
    expect(sql).toContain('(select auth.uid()) = user_id');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('on conflict (user_id, ride_id) do nothing');
    expect(sql).toContain('grant execute on function public.list_my_favourite_rides() to authenticated');
    expect(sql).not.toContain('pickup_place_id');
    expect(sql).not.toContain('pickup_latitude');
    expect(sql).not.toContain('pickup_instructions');
  });
});
