const colorClasses = {
  profit: 'text-emerald-400',
  loss: 'text-red-400',
  neutral: 'text-slate-100',
};

export default function StatCard({ label, value, subtitle, color = 'neutral' }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 md:p-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 md:text-xs">{String(label ?? '')}</p>
      <p className={`mt-1 text-lg font-semibold md:mt-2 md:text-2xl ${colorClasses[color] ?? colorClasses.neutral}`}>
        {String(value ?? '--')}
      </p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{String(subtitle)}</p> : null}
    </div>
  );
}
