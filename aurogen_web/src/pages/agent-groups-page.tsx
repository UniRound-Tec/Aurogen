import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  LoaderCircle,
  MessageSquarePlus,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Users,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type AgentEntry = {
  key: string
  name: string
  description: string
  provider: string
  emoji?: string
}

type GroupRunInfo = {
  run_id: string
  title: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  instruction: string
  leader_provider: string
  members: string[]
  member_descriptions: Record<string, string>
  agent_cursors: Record<string, number>
  next_seq: number
  created_at: string
  updated_at: string
  finished_at?: string | null
  final_message?: string | null
  error_message?: string | null
}

type GroupEvent = {
  seq: number
  type: string
  speaker: string
  target: string
  content: string
  created_at: string
  meta?: Record<string, unknown>
}

type GroupEventsResponse = {
  run_id: string
  status: string
  next_seq: number
  events: GroupEvent[]
}

async function fetchAgents() {
  return fetchJson<{ agents: AgentEntry[] }>('/agents')
}

async function fetchRuns() {
  return fetchJson<{ runs: GroupRunInfo[] }>('/agent-groups/runs')
}

async function fetchRun(runId: string) {
  return fetchJson<GroupRunInfo>(`/agent-groups/runs/${encodeURIComponent(runId)}`)
}

async function fetchRunEvents(runId: string, afterSeq = 0) {
  return fetchJson<GroupEventsResponse>(
    `/agent-groups/runs/${encodeURIComponent(runId)}/events?after_seq=${afterSeq}`,
  )
}

async function createRun(payload: { members: string[]; instruction: string; title?: string }) {
  return fetchJson<GroupRunInfo>('/agent-groups/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

async function stopRun(runId: string) {
  return fetchJson<GroupRunInfo>(`/agent-groups/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  })
}

async function appendRunMessage(runId: string, message: string) {
  return fetchJson<GroupRunInfo>(`/agent-groups/runs/${encodeURIComponent(runId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

function toneForEvent(type: string) {
  if (type.includes('failed')) {
    return 'border-[color:var(--color-danger)]/25 bg-[color:var(--color-danger)]/10 text-[var(--color-danger)]'
  }
  if (type.includes('final') || type.includes('completed')) {
    return 'border-[var(--color-success)]/25 bg-[var(--color-success)]/10 text-[var(--color-success)]'
  }
  if (type.includes('delegate')) {
    return 'border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
  }
  if (type.includes('thinking')) {
    return 'border-[var(--color-thinking)]/25 bg-[var(--color-thinking)]/10 text-[var(--color-thinking)]'
  }
  if (type.includes('tool')) {
    return 'border-[var(--color-tool)]/25 bg-[var(--color-tool)]/10 text-[var(--color-tool)]'
  }
  return 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 text-[var(--color-text-secondary)]'
}

function statusTone(status: GroupRunInfo['status']) {
  if (status === 'running') return 'text-[var(--color-accent)]'
  if (status === 'completed') return 'text-[var(--color-success)]'
  if (status === 'failed') return 'text-[var(--color-danger)]'
  return 'text-[var(--color-warning)]'
}

export function AgentGroupsPage() {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [runs, setRuns] = useState<GroupRunInfo[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<GroupRunInfo | null>(null)
  const [events, setEvents] = useState<GroupEvent[]>([])
  const [instruction, setInstruction] = useState('')
  const [title, setTitle] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [draftMembers, setDraftMembers] = useState<string[]>([])
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  const [followupMessage, setFollowupMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [sendingFollowup, setSendingFollowup] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    const data = await fetchRuns()
    setRuns(data.runs)
    return data.runs
  }, [])

  const loadRunDetail = useCallback(async (runId: string) => {
    const [run, eventPayload] = await Promise.all([
      fetchRun(runId),
      fetchRunEvents(runId, 0),
    ])
    setSelectedRun(run)
    setEvents(eventPayload.events)
  }, [])

  const initialize = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [agentsRes, runList] = await Promise.all([fetchAgents(), loadRuns()])
      setAgents(agentsRes.agents)
      if (runList.length > 0) {
        const nextRunId = selectedRunId && runList.some((item) => item.run_id === selectedRunId)
          ? selectedRunId
          : runList[0].run_id
        setSelectedRunId(nextRunId)
        await loadRunDetail(nextRunId)
      } else {
        setSelectedRunId(null)
        setSelectedRun(null)
        setEvents([])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('groups.loadFailed')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [loadRunDetail, loadRuns, selectedRunId, t])

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (!selectedRunId) {
      return
    }
    const runId = selectedRunId
    let cancelled = false
    async function syncSelected() {
      try {
        const run = await fetchRun(runId)
        if (!cancelled) {
          setSelectedRun(run)
          setRuns((current) => {
            const exists = current.some((item) => item.run_id === run.run_id)
            const next = exists
              ? current.map((item) => (item.run_id === run.run_id ? run : item))
              : [run, ...current]
            return [...next].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          })
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : t('groups.loadFailed')
          setError(msg)
        }
      }
    }
    void syncSelected()
    return () => {
      cancelled = true
    }
  }, [selectedRunId, t])

  useEffect(() => {
    if (!selectedRunId || selectedRun?.status !== 'running') {
      return
    }
    const runId = selectedRunId
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const afterSeq = events.length > 0 ? events[events.length - 1]!.seq : 0
          const [run, payload] = await Promise.all([
            fetchRun(runId),
            fetchRunEvents(runId, afterSeq),
          ])
          setSelectedRun(run)
          setRuns((current) => {
            const exists = current.some((item) => item.run_id === run.run_id)
            const next = exists
              ? current.map((item) => (item.run_id === run.run_id ? run : item))
              : [run, ...current]
            return [...next].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          })
          if (payload.events.length > 0) {
            setEvents((current) => [...current, ...payload.events])
          }
        } catch {
          // Keep polling resilient without interrupting the UI.
        }
      })()
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [events, selectedRun?.status, selectedRunId])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const runList = await loadRuns()
      if (selectedRunId) {
        await loadRunDetail(selectedRunId)
      } else if (runList.length > 0) {
        setSelectedRunId(runList[0].run_id)
        await loadRunDetail(runList[0].run_id)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('groups.loadFailed')
      setError(msg)
    } finally {
      setRefreshing(false)
    }
  }, [loadRunDetail, loadRuns, selectedRunId, t])

  const handleToggleDraftMember = useCallback((agentKey: string) => {
    setDraftMembers((current) =>
      current.includes(agentKey)
        ? current.filter((item) => item !== agentKey)
        : [...current, agentKey],
    )
  }, [])

  const openMemberPicker = useCallback(() => {
    setDraftMembers(selectedMembers)
    setMemberPickerOpen(true)
  }, [selectedMembers])

  const handleConfirmMembers = useCallback(() => {
    setSelectedMembers(draftMembers)
    setMemberPickerOpen(false)
  }, [draftMembers])

  const handleCreate = useCallback(async () => {
    if (!instruction.trim() || selectedMembers.length === 0) {
      return
    }
    setCreating(true)
    setError(null)
    try {
      const run = await createRun({
        title: title.trim() || undefined,
        instruction: instruction.trim(),
        members: selectedMembers,
      })
      setInstruction('')
      setTitle('')
      setSelectedRunId(run.run_id)
      setSelectedRun(run)
      setEvents([])
      await handleRefresh()
      await loadRunDetail(run.run_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('groups.createFailed')
      setError(msg)
    } finally {
      setCreating(false)
    }
  }, [handleRefresh, instruction, loadRunDetail, selectedMembers, t, title])

  const handleStop = useCallback(async () => {
    if (!selectedRunId) {
      return
    }
    setStopping(true)
    setError(null)
    try {
      const run = await stopRun(selectedRunId)
      setSelectedRun(run)
      setRuns((current) =>
        current
          .map((item) => (item.run_id === run.run_id ? run : item))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      )
      await loadRunDetail(run.run_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('groups.stopFailed')
      setError(msg)
    } finally {
      setStopping(false)
    }
  }, [loadRunDetail, selectedRunId, t])

  const handleSendFollowup = useCallback(async () => {
    if (!selectedRunId || !followupMessage.trim()) {
      return
    }
    setSendingFollowup(true)
    setError(null)
    try {
      const run = await appendRunMessage(selectedRunId, followupMessage.trim())
      setFollowupMessage('')
      setSelectedRun(run)
      setRuns((current) =>
        current
          .map((item) => (item.run_id === run.run_id ? run : item))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      )
      await loadRunDetail(run.run_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('groups.followupFailed')
      setError(msg)
    } finally {
      setSendingFollowup(false)
    }
  }, [followupMessage, loadRunDetail, selectedRunId, t])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      {error ? (
        <div className="panel-surface flex items-start gap-3 border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{t('groups.currentIssue')}</p>
            <p className="mt-1 text-[13px] text-[var(--color-danger)]/90">{error}</p>
          </div>
        </div>
      ) : null}

      <header className="panel-surface flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
            <BrainCircuit className="h-4.5 w-4.5 text-[var(--color-accent)]" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('groups.console')}</p>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Agent Groups</h1>
            <p className="max-w-3xl text-[13px] subtle-text">{t('groups.description')}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void handleRefresh()
          }}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('groups.refresh')}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[280px_minmax(0,1.2fr)_360px]">
        <aside className="panel-surface flex min-h-0 overflow-hidden flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('groups.runs')}</h2>
              <p className="mt-1 text-[11px] tertiary-text">{t('groups.runsHint')}</p>
            </div>
            <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              {runs.length} total
            </div>
          </div>

          <div className="scroll-area min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {loading ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/40 px-4 py-6 text-sm subtle-text">
                {t('common.loading')}
              </div>
            ) : runs.length > 0 ? (
              runs.map((run) => {
                const selected = selectedRunId === run.run_id
                return (
                  <button
                    key={run.run_id}
                    type="button"
                    onClick={() => {
                      setSelectedRunId(run.run_id)
                      void loadRunDetail(run.run_id)
                    }}
                    className={cn(
                      'w-full rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-all duration-150',
                      selected
                        ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50 hover:shadow-[var(--shadow-sm)]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                        {run.title || run.run_id}
                      </span>
                      <span className={cn('text-[11px] font-medium uppercase tracking-[0.06em]', statusTone(run.status))}>
                        {run.status}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[12px] subtle-text">{run.instruction}</p>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] tertiary-text">
                      <span>{run.members.length} agents</span>
                      <span>{run.updated_at || run.created_at}</span>
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-6 text-sm subtle-text">
                {t('groups.empty')}
              </div>
            )}
          </div>
        </aside>

        <section className="panel-surface flex min-h-0 overflow-hidden flex-col">
          <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('groups.transcript')}</h2>
                <p className="mt-1 text-[11px] tertiary-text">
                  {selectedRun ? selectedRun.run_id : t('groups.selectRun')}
                </p>
              </div>
              <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
                {t('groups.autoRefresh')}
              </span>
            </div>
          </div>

          <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {selectedRun ? (
              events.length > 0 ? (
                <div className="space-y-3">
                  {events.map((event) => (
                    <TranscriptCard key={`${event.seq}-${event.type}`} event={event} />
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-6 text-center">
                  <Bot className="h-8 w-8 text-[var(--color-accent)]" />
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('groups.noEvents')}</h3>
                    <p className="max-w-lg text-sm subtle-text">{t('groups.noEventsHint')}</p>
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-6 text-center">
                <Users className="h-8 w-8 text-[var(--color-accent)]" />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('groups.selectRun')}</h3>
                  <p className="max-w-lg text-sm subtle-text">{t('groups.selectRunHint')}</p>
                </div>
              </div>
            )}
          </div>

          {selectedRun ? (
            <div className="shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[12px] subtle-text">
                  <MessageSquarePlus className="h-4 w-4 text-[var(--color-accent)]" />
                  {t('groups.followupHint')}
                </div>
                <textarea
                  rows={3}
                  value={followupMessage}
                  onChange={(event) => {
                    setFollowupMessage(event.target.value)
                  }}
                  placeholder={t('groups.followupPlaceholder')}
                  className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-3 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      void handleSendFollowup()
                    }}
                    disabled={sendingFollowup || !followupMessage.trim()}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sendingFollowup ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
                    {t('groups.sendFollowup')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="panel-surface flex min-h-0 overflow-hidden flex-col p-5">
          <div className="mb-4">
            <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('groups.createRun')}</h2>
            <p className="mt-1 text-[11px] tertiary-text">{t('groups.createHint')}</p>
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-2 text-[11px] tracking-[0.06em] tertiary-text">{t('groups.title')}</p>
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                }}
                placeholder={t('groups.titlePlaceholder')}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
              />
            </div>

            <div>
              <p className="mb-2 text-[11px] tracking-[0.06em] tertiary-text">{t('groups.instruction')}</p>
              <textarea
                rows={4}
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value)
                }}
                placeholder={t('groups.instructionPlaceholder')}
                className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-3 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('groups.members')}</p>
                <span className="text-[11px] subtle-text">
                  {selectedMembers.length} / {agents.length}
                </span>
              </div>
              <button
                type="button"
                onClick={openMemberPicker}
                className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-3 text-left text-[13px] text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]"
              >
                <span className="truncate">
                  {selectedMembers.length > 0 ? selectedMembers.join(', ') : t('groups.membersPlaceholder')}
                </span>
                <span className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] subtle-text">
                  {t('groups.selectMembersBtn')}
                </span>
              </button>
              {selectedMembers.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedMembers.map((member) => (
                    <span
                      key={member}
                      className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] subtle-text"
                    >
                      {member}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-[11px] tertiary-text">{t('groups.memberPickerHint')}</p>
            </div>

            <button
              type="button"
              onClick={() => {
                void handleCreate()
              }}
              disabled={creating || !instruction.trim() || selectedMembers.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bg-app)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--color-text-primary)]/90 hover:shadow-[0_2px_8px_var(--color-border-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {t('groups.startRun')}
            </button>
          </div>

          <div className="my-4 h-px bg-[var(--color-bg-active)]" />

          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('groups.runDetails')}</h3>
            {selectedRun?.status === 'running' ? (
              <button
                type="button"
                onClick={() => {
                  void handleStop()
                }}
                disabled={stopping}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/35 bg-[color:var(--color-danger)]/12 px-3 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stopping ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                {t('groups.stopRun')}
              </button>
            ) : null}
          </div>

          {selectedRun ? (
            <div className="space-y-3 overflow-y-auto">
              <DetailField label={t('groups.status')}>{selectedRun.status}</DetailField>
              <DetailField label={t('groups.leaderProvider')}>{selectedRun.leader_provider}</DetailField>
              <DetailField label={t('groups.members')}>
                <div className="flex flex-wrap gap-2">
                  {selectedRun.members.map((member) => (
                    <span
                      key={member}
                      className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] subtle-text"
                    >
                      {member}
                    </span>
                  ))}
                </div>
              </DetailField>
              <DetailField label={t('groups.createdAt')}>{selectedRun.created_at || '—'}</DetailField>
              <DetailField label={t('groups.updatedAt')}>{selectedRun.updated_at || '—'}</DetailField>
              <DetailField label={t('groups.finalMessage')}>
                {selectedRun.final_message || '—'}
              </DetailField>
              {selectedRun.error_message ? (
                <DetailField label={t('groups.errorMessage')}>
                  {selectedRun.error_message}
                </DetailField>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-5 text-sm subtle-text">
              {t('groups.selectRunHint')}
            </div>
          )}
        </aside>
      </div>

      <MemberPickerModal
        open={memberPickerOpen}
        agents={agents}
        selectedMembers={draftMembers}
        onToggleMember={handleToggleDraftMember}
        onClose={() => {
          setMemberPickerOpen(false)
        }}
        onConfirm={handleConfirmMembers}
      />
    </section>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
      <p className="mb-1 text-[11px] tracking-[0.06em] tertiary-text">{label}</p>
      <div className="break-words text-sm text-[var(--color-text-primary)]">{children}</div>
    </div>
  )
}

function TranscriptCard({ event }: { event: GroupEvent }) {
  const { t } = useTranslation()

  const markdownBlock = (
    <div className="markdown-content text-sm leading-6 text-[var(--color-text-primary)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {event.content || '—'}
      </ReactMarkdown>
    </div>
  )

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/45 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('rounded-full border px-3 py-1 text-[11px] font-medium', toneForEvent(event.type))}>
            {event.type}
          </span>
          <span className="min-w-0 truncate text-[12px] text-[var(--color-text-primary)]">
            {event.speaker} → {event.target}
          </span>
        </div>
        <span className="text-[11px] tertiary-text">#{event.seq} · {event.created_at}</span>
      </div>

      {event.type === 'member_tool_result' ? (
        <details className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-3 py-2.5">
          <summary className="cursor-pointer list-none text-[12px] font-medium text-[var(--color-text-primary)]">
            {t('groups.viewToolResult')}
          </summary>
          <div className="mt-3">{markdownBlock}</div>
        </details>
      ) : (
        markdownBlock
      )}

      {event.meta && Object.keys(event.meta).length > 0 ? (
        <details className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-3 py-2.5">
          <summary className="cursor-pointer list-none text-[12px] font-medium text-[var(--color-text-primary)]">
            {t('groups.viewMeta')}
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 subtle-text">
            {JSON.stringify(event.meta, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function MemberPickerModal({
  open,
  agents,
  selectedMembers,
  onToggleMember,
  onClose,
  onConfirm,
}: {
  open: boolean
  agents: AgentEntry[]
  selectedMembers: string[]
  onToggleMember: (agentKey: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="panel-surface w-full max-w-3xl p-5 shadow-[var(--shadow-lg)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('groups.members')}</p>
            <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{t('groups.selectMembersTitle')}</h3>
            <p className="mt-1 text-sm subtle-text">{t('groups.selectMembersDesc')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] p-2 text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {agents.map((agent) => {
            const selected = selectedMembers.includes(agent.key)
            return (
              <button
                key={agent.key}
                type="button"
                onClick={() => {
                  onToggleMember(agent.key)
                }}
                className={cn(
                  'w-full rounded-[var(--radius-sm)] border px-3 py-3 text-left transition',
                  selected
                    ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                      {agent.emoji ? `${agent.emoji} ` : ''}{agent.key}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] subtle-text">
                      {agent.description || t('groups.noDescription')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] tertiary-text">
                      {agent.provider}
                    </span>
                    {selected ? <CheckCircle2 className="h-4 w-4 text-[var(--color-accent)]" /> : null}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[12px] subtle-text">{t('groups.selectedCount', { count: selectedMembers.length })}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90"
            >
              {t('groups.confirmMembers')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
