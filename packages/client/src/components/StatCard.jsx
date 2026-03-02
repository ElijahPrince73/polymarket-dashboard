const colorStyles = {
  default: 'text-slate-100',
  profit: 'text-emerald-400',
  loss: 'text-red-400',
  warning: 'text-yellow-400',
};

export default function StatCard({ label, value, trend, color = 'default' }) {
  const valueClass = colorStyles[color] || colorStyles.default;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueClass}`}>
        {value && typeof value === 'object' ? JSON.stringify(value) : value}
      </p>
      {trend ? <p className="mt-1 text-xs text-slate-400">{trend}</p> : null}
    </div>
  );
}
