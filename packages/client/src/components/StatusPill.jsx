const variantClasses = {
  success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  danger: 'border-red-500/40 bg-red-500/15 text-red-300',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  neutral: 'border-slate-600 bg-slate-700/40 text-slate-300',
};

export default function StatusPill({ label, value, variant = 'neutral' }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${variantClasses[variant] ?? variantClasses.neutral}`}
    >
      <span className="text-slate-400">{String(label)}</span>
      <span>{String(value)}</span>
    </span>
  );
}
