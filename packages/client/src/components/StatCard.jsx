const colorClasses = {
  profit: 'text-[var(--success)]',
  loss: 'text-[var(--accent)]',
  neutral: 'text-[var(--text-display)]',
};

export default function StatCard({ label, value, subtitle, color = 'neutral' }) {
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-none">
      <p className="font-label text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        {String(label ?? '')}
      </p>
      <p
        className={`font-body mt-3 text-[24px] font-medium tracking-tight ${colorClasses[color] ?? colorClasses.neutral}`}
      >
        {String(value ?? '--')}
      </p>
      {subtitle ? (
        <p className="font-label mt-2 text-[12px] text-[var(--text-disabled)]">{String(subtitle)}</p>
      ) : null}
    </div>
  );
}
