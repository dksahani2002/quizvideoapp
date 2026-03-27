import { NavLink, useNavigate } from 'react-router-dom';
import { Home, PlusCircle, Settings, Film, LogOut, UploadCloud, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';

const links = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/create', icon: PlusCircle, label: 'Create Video' },
  { to: '/videos', icon: Film, label: 'Video Library' },
  { to: '/publishing', icon: UploadCloud, label: 'Publishing' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside className="h-full w-60 bg-[hsl(var(--card))] border-r border-[hsl(var(--border))] flex flex-col">
      <div className="p-5 border-b border-[hsl(var(--border))]">
        <h1 className="text-lg font-bold text-[hsl(var(--primary))]">MCQ Shorts</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Quiz Video Generator</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]'
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]'
              )
            }
          >
            <Shield size={18} />
            Admin
          </NavLink>
        )}
      </nav>
      {user && (
        <div className="p-4 border-t border-[hsl(var(--border))]">
          <div className="mb-3">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition-colors w-full"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}
