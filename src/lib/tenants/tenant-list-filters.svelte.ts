import { goto } from "$app/navigation";
import { page } from "$app/state";
import { BUCKETS, bucketOf, parseBucket, type TenantBucket } from "$lib/tenants/tenant-filter";
import type { Room, Tenant } from "$lib/tenants/types";

/**
 * Search + URL-backed filters for the tenants page.
 *
 * The URL is the single source of truth for the active payment-status chip;
 * `frozenIds` is the snapshot of which tenants belonged to that bucket when it
 * was picked — a list reload after recording a payment must NOT yank a card out
 * of the set the landlord is working through. Search and the ?room= chip stay
 * live.
 *
 * Runes are created here, so call this once during component initialisation.
 */
export function createTenantListFilters(options: {
  /** Active (not moved-out) tenants — the bucket snapshot is built from this. */
  getActive: () => Tenant[];
  /** Archived (moved-out) tenants; search applies, status does not. */
  getArchived: () => Tenant[];
  getRooms: () => Room[];
  /** True while the first load is in flight; the snapshot sync waits for it. */
  isLoading: () => boolean;
  /** Collapse the "More options" accordion, like a list reload does. */
  onBeforeMutate: () => void;
}) {
  let searchQuery = $state("");

  const statusFilter = $derived(parseBucket(page.url.searchParams.get("status")));
  /** Ids captured for the selected bucket; null = no bucket selected. */
  let frozenIds = $state<Set<number> | null>(null);
  /** The ?status= value `frozenIds` was built for; "init" until the first sync. */
  let syncedParam: TenantBucket | null | "init" = $state("init");

  /** Search across name / contact / room number. */
  function matchesSearch(t: Tenant): boolean {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.contact.toLowerCase().includes(q) ||
      t.room_number.toLowerCase().includes(q)
    );
  }

  /** Freeze the bucket's membership from the (unsearched) active list. */
  function freezeBucket(bucket: TenantBucket | null) {
    syncedParam = bucket;
    frozenIds =
      bucket === null
        ? null
        : new Set(options.getActive().filter((t) => bucketOf(t) === bucket).map((t) => t.id));
  }

  /** Select, switch, or clear (re-tap) a bucket: freeze it, then push the URL. */
  function selectBucket(bucket: TenantBucket | null) {
    options.onBeforeMutate();
    freezeBucket(bucket);
    const params = new URLSearchParams(page.url.searchParams);
    if (bucket) params.set("status", bucket);
    else params.delete("status");
    const qs = params.toString();
    // Default push: the browser Back button steps back through filter choices.
    goto(qs ? `/tenants?${qs}` : "/tenants", { keepFocus: true, noScroll: true });
  }

  /** Drop only the ?room= chip, keeping any selected payment bucket. */
  function clearRoomFilter() {
    const params = new URLSearchParams(page.url.searchParams);
    params.delete("room");
    const qs = params.toString();
    goto(qs ? `/tenants?${qs}` : "/tenants", { keepFocus: true, noScroll: true });
  }

  // Browser Back/Forward changes ?status= without a tap — re-freeze so the list
  // always matches the chip. Keyed on the param (and the first data load) only:
  // the page's reload must not rebuild the snapshot.
  $effect(() => {
    const param = statusFilter;
    if (options.isLoading()) return;
    if (param === syncedParam) return;
    freezeBucket(param);
  });

  // ----- room filter (?room= param — set by the rooms page's "Manage tenants"
  // menu item, deep-linkable). Applies to the Active list only. An unknown
  // room id degrades gracefully to no filter. -----
  const filterRoom = $derived(
    (() => {
      const raw = page.url.searchParams.get("room");
      if (!raw) return null;
      const id = Number(raw);
      if (!Number.isFinite(id)) return null;
      return options.getRooms().find((r) => r.id === id) ?? null;
    })()
  );

  // Order: frozen bucket membership → live search → live ?room= chip. The
  // `frozenIds` null-fallback only runs before the first snapshot sync (a deep
  // link straight to ?status=...), so the list is never briefly empty.
  const visibleActive = $derived(
    options
      .getActive()
      .filter(
        (t) =>
          statusFilter === null ||
          (frozenIds ? frozenIds.has(t.id) : bucketOf(t) === statusFilter)
      )
      .filter(matchesSearch)
      .filter((t) => !filterRoom || t.room_id === filterRoom.id)
  );

  const visibleArchived = $derived(options.getArchived().filter(matchesSearch));

  /** Empty-state copy for the Active list: bucket-specific, else the search template. */
  const activeEmptyMessage = $derived.by(() => {
    const q = searchQuery.trim();
    if (q) return `No tenants match “${q}”.`;
    return BUCKETS.find((b) => b.key === statusFilter)?.empty ?? `No tenants match “${q}”.`;
  });

  return {
    get searchQuery() {
      return searchQuery;
    },
    set searchQuery(value: string) {
      searchQuery = value;
    },
    get statusFilter() {
      return statusFilter;
    },
    get filterRoom() {
      return filterRoom;
    },
    get visibleActive() {
      return visibleActive;
    },
    get visibleArchived() {
      return visibleArchived;
    },
    get activeEmptyMessage() {
      return activeEmptyMessage;
    },
    selectBucket,
    clearRoomFilter,
  };
}
