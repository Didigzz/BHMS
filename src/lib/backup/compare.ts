// ---------------------------------------------------------------------------
// Comparing a backup against what the device already holds
// ---------------------------------------------------------------------------

/** A table where the backup carries fewer rows than the database has now. */
export interface BackupReduction {
  table: string;
  label: string;
  backup: number;
  live: number;
}

export interface BackupSizeComparison {
  /** True when the file carries fewer rows in total than the database has now. */
  isSmaller: boolean;
  backupTotal: number;
  liveTotal: number;
  /** Per-table reductions, biggest loss first, for the warning copy. */
  reductions: BackupReduction[];
}

/**
 * Compare a validated backup against what the database holds now.
 *
 * Importing always replaces everything, so the case worth warning about is a
 * file carrying *less* than the device already has: a landlord who picks an old
 * backup should see both numbers before anything is erased. The warning is
 * advisory — a confirmed import proceeds.
 */
export function compareBackupToLive(
  backupCounts: { table: string; label: string; count: number }[],
  liveCounts: Record<string, number>
): BackupSizeComparison {
  const reductions: BackupReduction[] = [];
  let backupTotal = 0;
  let liveTotal = 0;

  for (const { table, label, count } of backupCounts) {
    const live = liveCounts[table] ?? 0;
    backupTotal += count;
    liveTotal += live;
    if (count < live) reductions.push({ table, label, backup: count, live });
  }

  reductions.sort((a, b) => b.live - b.backup - (a.live - a.backup));
  return { isSmaller: backupTotal < liveTotal, backupTotal, liveTotal, reductions };
}
