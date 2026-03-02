const colorClasses = {
  profit: 'text-emerald-400',
  loss: 'text-red-400',
  neutral: 'text-slate-100',
};

export default function StatCard({ label, value, subtitle, color = 'neutral' }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{String(label ?? '')}</p>
      <p className={`mt-2 text-2xl font-semibold ${colorClasses[color] ?? colorClasses.neutral}`}>
        {String(value ?? '--')}
      </p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{String(subtitle)}</p> : null}
    </div>
  );
}
