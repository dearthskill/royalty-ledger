// Small coloured pill for period, batch and payout statuses.
const STYLE: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  closed: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  uploaded: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  cleaned: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  disputed: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  aggregated: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STYLE[status] ?? ''}`}>{status}</span>;
}
