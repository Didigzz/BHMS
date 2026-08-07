<script lang="ts">
  import { onMount } from "svelte";
  import { modalMaterial } from "$lib/motion";
  import { getSetting } from "$lib/settings";
  import { formatDate, formatMonthRange, phpPesoPrecise } from "$lib/format";
  import { shareReceiptImage } from "$lib/share";
  import { pushToast } from "$lib/toast.svelte";
  import type { PaymentRecord } from "./types";

  let {
    tenant,
    rows,
    onClose,
  }: {
    tenant: { name: string; room_number: string };
    rows: PaymentRecord[];
    onClose: () => void;
  } = $props();

  let houseName = $state("Digal Boarding House");
  let houseLoaded = $state(false);
  let exporting = $state(false);
  let shareError: string | null = $state(null);
  let receiptEl: HTMLDivElement | undefined = $state();

  // One payment transaction = one receipt. rows are ordered by covered month
  // (id ASC), so the first/last rows bound the covered-month range.
  const receiptNo = $derived(rows[0]?.receipt_no ?? "");
  const total = $derived(rows.reduce((acc, r) => acc + r.amount, 0));
  const paidDate = $derived(rows[0]?.paid_date ?? "");
  const firstMonth = $derived(rows[0]?.covers_month ?? null);
  const lastMonth = $derived(rows.length > 0 ? rows[rows.length - 1].covers_month : null);
  const method = $derived(rows[0]?.method ?? "—");

  onMount(async () => {
    houseName = await getSetting("house_name", "Digal Boarding House");
    houseLoaded = true;
  });

  /** Capture the receipt as a PNG and share / download it. */
  async function exportReceipt() {
    if (!receiptEl || exporting) return;
    exporting = true;
    shareError = null;
    try {
      await document.fonts.ready;
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(receiptEl, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const result = await shareReceiptImage(dataUrl, `receipt-${receiptNo || "000000"}.png`);
      pushToast(
        result === "downloaded"
          ? "Receipt image downloaded"
          : "Receipt saved to Photos",
        "success"
      );
    } catch (e) {
      shareError = String(e);
    } finally {
      exporting = false;
    }
  }
</script>

<div class="modal" role="dialog" aria-label="Receipt" transition:modalMaterial>
  <div class="receipt-panel">
    <div class="receipt" bind:this={receiptEl}>
      <div class="receipt-head">
        <div class="receipt-house">{houseName}</div>
        <div class="receipt-title">OFFICIAL RECEIPT</div>
      </div>

      <div class="r-divider"></div>

      <div class="r-row"><span>Receipt No.</span><strong>{receiptNo}</strong></div>
      <div class="r-row"><span>Date</span><strong>{formatDate(paidDate)}</strong></div>
      <div class="r-row"><span>Tenant</span><strong>{tenant.name}</strong></div>
      <div class="r-row"><span>Room</span><strong>{tenant.room_number}</strong></div>

      <div class="r-divider"></div>

      <div class="r-row">
        <span>Month(s) covered</span>
        <strong>{formatMonthRange(firstMonth, lastMonth)}</strong>
      </div>
      <div class="r-row"><span>Amount</span><strong>{phpPesoPrecise(total)}</strong></div>
      <div class="r-row">
        <span>Payment method</span>
        <strong>{method === "—" ? "—" : method}</strong>
      </div>
      <div class="r-row r-status"><span>Status</span><strong>PAID IN FULL</strong></div>

      <div class="r-divider"></div>

      <div class="r-sign">Signature of landlord / authorized rep.</div>
    </div>

    {#if shareError}
      <p class="form-error">{shareError}</p>
    {/if}

    <div class="form-actions">
      <button type="button" class="btn" onclick={onClose} disabled={exporting}>Close</button>
      <button type="button" class="btn btn-paid" onclick={exportReceipt} disabled={exporting || !houseLoaded}>
        {exporting ? "Saving…" : "Save to Photos"}
      </button>
    </div>
  </div>
</div>

<style>
  .receipt-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* The receipt itself uses fixed colors (no theme vars) and monospace type so
     the exported PNG looks identical in light/dark mode and on any device. */
  .receipt {
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
    box-sizing: border-box;
    background: #ffffff;
    color: #1c1c1e;
    border: 1px solid #d9d9d9;
    border-radius: 8px;
    padding: 20px 18px;
    font-family: "Courier New", Courier, monospace;
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .receipt-head {
    text-align: center;
    margin-bottom: 10px;
  }

  .receipt-house {
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .receipt-title {
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    color: #555555;
    margin-top: 2px;
  }

  .r-divider {
    border-top: 1px dashed #b9b9b9;
    margin: 10px 0;
  }

  .r-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
  }

  .r-row span {
    color: #555555;
  }

  .r-row strong {
    font-weight: 700;
    text-align: right;
    word-break: break-word;
  }

  .r-status strong {
    color: #0b6e2f;
  }

  .r-sign {
    color: #555555;
    font-size: 0.75rem;
    text-align: center;
    padding-top: 4px;
  }
</style>
