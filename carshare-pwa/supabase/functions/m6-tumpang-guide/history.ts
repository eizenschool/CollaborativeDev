type Client = { from: (table: string) => any };

// Returns category counts only. Account IDs, contacts, ride companions,
// coordinates and route text never leave this server-side boundary.
export async function retrieveTripHistoryCategories(
  admin: Client, userId: string | null, places: Record<string, unknown>[], consent: boolean
) {
  if (!userId || !consent) return [];
  const [{ data: hosting }, { data: joining }] = await Promise.all([
    admin.from("rides").select("destination_place_id,departure_at")
      .eq("host_id", userId).eq("status", "Completed").order("departure_at", { ascending: false }).limit(50),
    admin.from("ride_requests").select("ride:rides!inner(destination_place_id,departure_at,status)")
      .eq("requester_id", userId).eq("status", "Accepted").eq("ride.status", "Completed").limit(50)
  ]);
  const categoryBySource = new Map(places.map((place) => [String(place.source_place_id), String(place.category)]));
  return [
    ...(hosting || []).map((row: Record<string, unknown>) => row.destination_place_id),
    ...(joining || []).map((row: Record<string, any>) => row.ride?.destination_place_id)
  ].map((sourceId) => categoryBySource.get(String(sourceId))).filter(Boolean) as string[];
}

