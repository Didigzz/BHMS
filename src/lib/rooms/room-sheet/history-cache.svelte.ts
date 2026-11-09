import { loadHistoryGroups, type Boarder, type PaymentGroup } from "./boarders";

/**
 * Payment history is loaded on first expand, per boarder, and kept for the life
 * of the sheet. The cache owns that state so the sheet does not carry four
 * records and two async functions for it.
 */
export function createHistoryCache() {
  let expanded = $state<Record<number, boolean>>({});
  let groups = $state<Record<number, PaymentGroup[]>>({});
  let loading = $state<Record<number, boolean>>({});
  let errors = $state<Record<number, string>>({});

  async function load(db: Parameters<typeof loadHistoryGroups>[0], b: Boarder) {
    try {
      groups[b.id] = await loadHistoryGroups(db, b.id);
    } catch (e) {
      errors[b.id] = `Failed to load payment history: ${String(e)}`;
    }
  }

  async function toggle(db: Parameters<typeof loadHistoryGroups>[0], b: Boarder) {
    const isOpen = expanded[b.id] === true;
    if (!isOpen && !groups[b.id] && !loading[b.id]) {
      loading[b.id] = true;
      try {
        await load(db, b);
      } finally {
        loading[b.id] = false;
      }
    }
    expanded[b.id] = !isOpen;
  }

  return {
    get expanded() {
      return expanded;
    },
    get groups() {
      return groups;
    },
    get loading() {
      return loading;
    },
    get errors() {
      return errors;
    },
    reload: load,
    toggle,
  };
}
