import { Activity, Blocks, Brain, BrainCircuit, CalendarClock, Cat, History, MessageSquareText, Package, Radio, Settings, Sparkles } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const navItemDefs = [
  { to: '/chat', label: 'Chat', descKey: 'nav.chatDesc', icon: MessageSquareText },
  { to: '/groups', label: 'Groups', descKey: 'nav.groupsDesc', icon: BrainCircuit },
  { to: '/brains', label: 'Brains', descKey: 'nav.brainsDesc', icon: Brain },
  { to: '/claws', label: 'Claws', descKey: 'nav.clawsDesc', icon: Cat },
  { to: '/channels', label: 'Channels', descKey: 'nav.channelsDesc', icon: Radio },
  { to: '/skills', label: 'Skills', descKey: 'nav.skillsDesc', icon: Package },
  { to: '/cron', label: 'Cron', descKey: 'nav.cronDesc', icon: CalendarClock },
  { to: '/mcp', label: 'MCP', descKey: 'nav.mcpDesc', icon: Blocks },
  { to: '/sessions', label: 'Sessions', descKey: 'nav.sessionsDesc', icon: History },
  { to: '/status', label: 'Status', descKey: 'nav.statusDesc', icon: Activity },
  { to: '/settings', label: 'Settings', descKey: 'nav.settingsDesc', icon: Settings },
] as const

const futureItems: string[] = []

export function AppShell() {
  const { t } = useTranslation()

  return (
    <div className="h-[100dvh] overflow-hidden bg-transparent px-4 py-4 text-[var(--color-text-primary)]">
      <div className="grid h-[calc(100dvh-2rem)] min-h-0 gap-4 overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="glass-surface flex min-h-0 overflow-hidden flex-col px-3 py-4">
          <div className="border-b border-[var(--color-border-subtle)] px-2 pb-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)]">
                <Sparkles className="h-4.5 w-4.5 text-[var(--color-accent)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Aurogen</p>
                <p className="text-[10px] tracking-[0.06em] tertiary-text">
                  Agent Ops Console
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mt-4 px-2">
            <p className="compact-eyebrow-text mb-2.5 text-[10px] uppercase tertiary-text">
              Main
            </p>
            <nav className="space-y-1.5">
              {navItemDefs.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition duration-[var(--duration-fast)]',
                        isActive
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                          : 'border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div
                          className={cn(
                            'mt-0.5 flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border transition',
                            isActive
                              ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                              : 'border-[var(--color-border-subtle)]/50 bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 transition-transform duration-150 group-hover:scale-110" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{item.label}</p>
                          <p className="mt-0.5 text-[11px] subtle-text">{t(item.descKey)}</p>
                        </div>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </nav>
          </div>

          {futureItems.length > 0 ? (
            <div className="mt-5 px-2">
              <p className="compact-eyebrow-text mb-2.5 text-[10px] uppercase tertiary-text">
                Later
              </p>
              <div className="space-y-1.5">
                {futureItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] px-4 py-2.5 text-[13px] subtle-text"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
