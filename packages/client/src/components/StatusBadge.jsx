const statusStyles = {
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  online: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  stopped: 'bg-red-500/20 text-red-400 border-red-500/40',
  error: 'bg-red-500/20 text-red-400 border-red-500/40',
  offline: 'bg-red-500/20 text-red-400 border-red-500/40',
  paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
};

export default function StatusBadge({ status = 'unknown' }) {
  // Safely convert to a display string — status may be an object from the API
  const label =
    status && typeof status === 'object'
      ? status.ok
        ? 'Running'
        : 'Error'
      : String(status ?? 'unknown');
  const normalized = label.toLowerCase();
  const classes =
    statusStyles[normalized] || 'bg-slate-700/40 text-slate-300 border-slate-600';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}
