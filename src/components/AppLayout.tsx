import { NavLink, Outlet } from 'react-router-dom';
import { Settings, LayoutDashboard, Upload, Clock, BookOpen, MessageSquare, Wifi, WifiOff, Cloud, Monitor, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getSettings, saveSettings } from '@/lib/storage';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/queue', icon: Upload, label: 'Upload Queue' },
  { to: '/schedule', icon: Clock, label: 'Schedule' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/setup', icon: BookOpen, label: 'Setup Guide' },
];

type ServerStatus = 'connected' | 'disconnected' | 'checking';

function useLocalServerStatus() {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const resp = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(3000) });
        if (mounted) setStatus(resp.ok ? 'connected' : 'disconnected');
      } catch {
        if (mounted) setStatus('disconnected');
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return status;
}

export default function AppLayout() {
  const serverStatus = useLocalServerStatus();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(),
  });

  const uploadMode = settings?.uploadMode || 'local';
  const isCloud = uploadMode === 'cloud';

  const toggleMode = async () => {
    if (!settings) return;
    const newMode = isCloud ? 'local' : 'cloud';
    const updated = { ...settings, uploadMode: newMode as 'local' | 'cloud' };
    await saveSettings(updated);
    queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-64 shrink-0 border-r bg-card flex flex-col">
        <div className="p-6 pb-4">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Video Uploader
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            YouTube · TikTok · Instagram
          </p>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t space-y-3">
          {/* Mode toggle button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleMode}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                  isCloud
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-secondary border-border text-muted-foreground hover:bg-secondary/80'
                )}
              >
                {isCloud ? (
                  <>
                    <Cloud className="w-4 h-4 text-emerald-600" />
                    <span>Cloud Mode</span>
                    <span className="ml-auto relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  </>
                ) : (
                  <>
                    <Monitor className="w-4 h-4" />
                    <span>Local Mode</span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px]">
              {isCloud
                ? 'Cloud mode active — uploads via Browserbase remote browser. Click to switch to local.'
                : 'Local mode — uploads via your PC server. Click to switch to cloud.'}
            </TooltipContent>
          </Tooltip>

          {/* Connection status */}
          {isCloud ? (
            <div className="flex items-center gap-2 px-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs text-emerald-600 font-medium">Browserbase connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1">
              {serverStatus === 'connected' ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <span className="text-xs text-emerald-600 font-medium">Local server connected</span>
                </>
              ) : serverStatus === 'checking' ? (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-xs text-muted-foreground">Checking server…</span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="text-xs text-muted-foreground">Local server offline</span>
                </>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground px-1">
            {isCloud ? 'Cloud DB · Cloud uploads' : 'Cloud DB · Local uploads'}
          </p>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
