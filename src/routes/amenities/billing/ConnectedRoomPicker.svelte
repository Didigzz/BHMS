<script lang="ts">
  let {
    rooms,
    selectedIds,
    onToggle,
  }: {
    rooms: { id: number; room_number: string }[];
    selectedIds: number[];
    onToggle: (id: number) => void;
  } = $props();
</script>

<div class="pick-list">
  {#each rooms as room (room.id)}
    <label class="pick-row room-row">
      <span class="pick-main">
        <input type="checkbox" checked={selectedIds.includes(room.id)} onchange={() => onToggle(room.id)} />
        <span class="pick-name">{room.room_number}</span>
      </span>
    </label>
  {/each}
</div>

<style>
  .pick-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pick-row {
    border: 1px solid var(--separator);
    border-radius: 12px;
    padding: 12px;
  }
  .room-row {
    cursor: pointer;
  }
  .pick-main {
    display: flex;
    align-items: center;
    gap: 11px;
    flex-wrap: wrap;
  }
  .pick-main input[type="checkbox"] {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--accent);
  }
  .pick-name {
    font-size: 0.95rem;
  }
</style>
