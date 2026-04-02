const variantClasses = {
  success: 'border-[var(--success)] text-[var(--success)]',
  danger: 'border-[var(--accent)] text-[var(--accent)]',
  warning: 'border-[var(--warning)] text-[var(--warning)]',
  neutral: 'border-[var(--border-visible)] text-[var(--text-secondary)]',
};

export default function StatusPill({ label, value, variant = 'neutral' }) {
  return (
    <span
      className={`font-label inline-flex items-center gap-2 rounded-[999px] border bg-transparent px-3 py-1 text-[11px] uppercase tracking-[0.08em] ${
        variantClasses[variant] ?? variantClasses.neutral
      }`}
    >
      <span>{String(label)}</span>
      <span>{String(value)}</span>
    </span>
  );
}
