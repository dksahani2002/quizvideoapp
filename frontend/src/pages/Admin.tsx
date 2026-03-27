import { useMemo, useState } from 'react';
import { useAdminUsers, useAuditLog } from '../api/admin';
import { useAuth } from '../hooks/useAuth';

export function AdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const users = useAdminUsers();
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const audit = useAuditLog({ userId: userId || undefined, action: action || undefined, limit: 50 });

  const userOptions = useMemo(() => users.data || [], [users.data]);

  if (!isAdmin) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Admin</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Admin</h1>
        <p className="text-[hsl(var(--muted-foreground))]">Audit log across all users</p>
      </div>

      <div className="bg-[hsl(var(--card))] rounded-xl p-5 border border-[hsl(var(--border))] mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">User</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
          >
            <option value="">All users</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} ({u.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-[hsl(var(--muted-foreground))]">Action</label>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. videos.generate"
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--input))] border border-[hsl(var(--border))] text-sm"
          />
        </div>
        <div className="flex items-end">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Showing {audit.data?.items?.length ?? 0} events
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {(audit.data?.items || []).map((e) => (
          <div key={e.id} className="bg-[hsl(var(--card))] rounded-xl border border-[hsl(var(--border))] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{e.action}</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                {e.statusCode} • {e.durationMs}ms
              </div>
            </div>
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {e.method} {e.path} • userId: {e.userId || '—'}
            </div>
            {e.error ? (
              <div className="mt-2 text-xs text-red-400 wrap-break-word">{e.error}</div>
            ) : null}
            <div className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))] wrap-break-word">
              {e.ip} • {e.userAgent}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

