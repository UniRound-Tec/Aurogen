import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Brain,
  Cable,
  CheckCircle2,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  SendHorizontal,
  Sparkles,
  Trash2,
  Unplug,
  Wrench,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { createApiUrl, fetchJson, getAuthKey } from '@/lib/api'
import { cn } from '@/lib/utils'

type SessionSummary = {
  session_id: string
  channel: string
  chat_id: string
}

type SessionListResponse = {
  agent_name: string
  sessions: SessionSummary[]
}

type PersistedMessage = {
  role: string
  content: string
  timestamp?: string
}

type SessionResponse = {
  agent_name: string
  session_id: string
  messages: PersistedMessage[]
}

type AgentDetail = {
  key: string
  builtin: boolean
  name: string
  description: string
  provider: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

type StreamEventType = 'thinking' | 'tool_call' | 'tool_result' | 'final'

type ChatEventPayload =
  | { content: string }
  | { tool_name: string; args: unknown }
  | { tool_name: string; result: string }

type ChatEventRecord = {
  id: string
  eventType: Exclude<StreamEventType, 'final'>
  data: ChatEventPayload
  createdAt: string
}

type RunStatus = 'idle' | 'connecting' | 'streaming' | 'disconnected' | 'error'

type ActiveRun = {
  id: string
  sessionId: string
  status: Exclude<RunStatus, 'idle'>
}

type SessionContext = {
  session: SessionSummary
  agentName: string
}

const WEB_CHANNEL = 'web'

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeMessage(message: PersistedMessage): ChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null
  }

  return {
    id: makeId(message.role),
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }
}

function formatTimestamp(value?: string, justNow?: string) {
  if (!value) {
    return justNow ?? '...'
  }

  return value
}

async function createChatSession() {
  return fetchJson<SessionContext['session'] & { agent_name: string }>('/chat/session', {
    method: 'POST',
    body: JSON.stringify({
      channel: WEB_CHANNEL,
    }),
  })
}

async function listSessions() {
  const data = await fetchJson<SessionListResponse>(`/list-sessions?channel=${WEB_CHANNEL}`)
  return {
    ...data,
    sessions: [...data.sessions].sort((left, right) =>
      right.session_id.localeCompare(left.session_id),
    ),
  }
}

async function getSession(sessionId: string) {
  return fetchJson<SessionResponse>(
    `/get-session?channel=${WEB_CHANNEL}&session_id=${encodeURIComponent(sessionId)}`,
  )
}

async function getAgent(agentName: string) {
  return fetchJson<AgentDetail>(`/agents/${encodeURIComponent(agentName)}`)
}

async function deleteSessionRequest(session: SessionSummary) {
  return fetchJson<{ message: string; agent_name: string; session_id: string }>(
    `/delete-session?channel=${encodeURIComponent(session.channel)}&session_id=${encodeURIComponent(session.session_id)}`,
    {
      method: 'DELETE',
    },
  )
}

function parseSseBlock(block: string) {
  const lines = block.split('\n')
  let eventType = ''
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (!eventType || dataLines.length === 0) {
    return null
  }

  return {
    eventType: eventType as StreamEventType,
    data: JSON.parse(dataLines.join('\n')) as ChatEventPayload,
  }
}

async function streamChat({
  sessionId,
  message,
  onEvent,
}: {
  sessionId: string
  message: string
  onEvent: (event: { eventType: StreamEventType; data: ChatEventPayload }) => void
}) {
  const response = await fetch(createApiUrl('/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Key': getAuthKey(),
    },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      metadata: {},
    }),
  })

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('aurogen:auth-failed'))
    }

    let payload: unknown = null

    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const detail = payload.detail
      if (typeof detail === 'string' && detail.trim()) {
        throw new Error(detail)
      }
      if (detail && typeof detail === 'object' && 'message' in detail) {
        const messageDetail = detail.message
        if (typeof messageDetail === 'string' && messageDetail.trim()) {
          throw new Error(messageDetail)
        }
      }
    }

    throw new Error(`消息发送失败（${response.status}）`)
  }

  if (!response.body) {
    throw new Error('SSE 连接未返回可读流')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    const normalized = buffer.replace(/\r\n/g, '\n')
    const blocks = normalized.split('\n\n')

    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const parsed = parseSseBlock(block.trim())
      if (!parsed) {
        continue
      }
      onEvent(parsed)
    }

    if (done) {
      break
    }
  }

  const tail = parseSseBlock(buffer.trim())
  if (tail) {
    onEvent(tail)
  }
}

function useChatController() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSession, setCurrentSession] = useState<SessionContext | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [timelineEvents, setTimelineEvents] = useState<ChatEventRecord[]>([])
  const [currentAgent, setCurrentAgent] = useState<AgentDetail | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
  const [lastRunState, setLastRunState] = useState<RunStatus>('idle')
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const loadTokenRef = useRef(0)
  const activeRunRef = useRef<ActiveRun | null>(null)

  useEffect(() => {
    activeRunRef.current = activeRun
  }, [activeRun])

  const hydrateAgent = useCallback(async (agentName: string) => {
    try {
      const detail = await getAgent(agentName)
      setCurrentAgent(detail)
    } catch {
      setCurrentAgent(null)
    }
  }, [])

  const openSession = useCallback(
    async (session: SessionSummary, knownAgentName?: string) => {
      const token = ++loadTokenRef.current
      setLoadingConversation(true)
      setError(null)
      setActiveRun(null)
      setLastRunState('idle')
      setTimelineEvents([])

      try {
        const detail = await getSession(session.session_id)

        if (token !== loadTokenRef.current) {
          return
        }

        const nextMessages = detail.messages
          .map(normalizeMessage)
          .filter((message): message is ChatMessage => message !== null)

        const agentName = knownAgentName ?? detail.agent_name

        setCurrentSession({
          session,
          agentName,
        })
        setMessages(nextMessages)
        setCurrentAgent(null)
        void hydrateAgent(agentName)
      } catch (loadError) {
        if (token !== loadTokenRef.current) {
          return
        }

        const message =
          loadError instanceof Error ? loadError.message : '会话加载失败'
        setError(message)
      } finally {
        if (token === loadTokenRef.current) {
          setLoadingConversation(false)
        }
      }
    },
    [hydrateAgent],
  )

  const createNewSession = useCallback(async () => {
    if (
      activeRunRef.current?.status === 'connecting' ||
      activeRunRef.current?.status === 'streaming'
    ) {
      return
    }

    setLoadingSessions(true)
    setError(null)
    setTimelineEvents([])
    setMessages([])
    setCurrentAgent(null)
    setActiveRun(null)
    setLastRunState('idle')

    try {
      const created = await createChatSession()
      const session = {
        session_id: created.session_id,
        channel: created.channel,
        chat_id: created.chat_id,
      }

      setSessions((current) => {
        const next = current.filter((item) => item.session_id !== session.session_id)
        return [session, ...next]
      })
      setCurrentSession({
        session,
        agentName: created.agent_name,
      })
      setLastRunState('idle')
      void hydrateAgent(created.agent_name)
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : '新建会话失败'
      setError(message)
    } finally {
      setLoadingSessions(false)
      setLoadingConversation(false)
    }
  }, [hydrateAgent])

  const refreshSessions = useCallback(async () => {
    const data = await listSessions()
    setSessions(data.sessions)
    return data
  }, [])

  useEffect(() => {
    let active = true

    async function initialize() {
      try {
        const data = await listSessions()

        if (!active) {
          return
        }

        setSessions(data.sessions)

        if (data.sessions.length > 0) {
          await openSession(data.sessions[0], data.agent_name)
        } else {
          await createNewSession()
        }
      } catch (loadError) {
        if (!active) {
          return
        }

        const message =
          loadError instanceof Error ? loadError.message : '初始化失败'
        setError(message)
      } finally {
        if (active) {
          setLoadingSessions(false)
        }
      }
    }

    void initialize()

    return () => {
      active = false
    }
  }, [createNewSession, openSession])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!currentSession || !content.trim()) {
        return
      }

      if (activeRun?.status === 'connecting' || activeRun?.status === 'streaming') {
        return
      }

      const sessionId = currentSession.session.session_id
      const runId = makeId('run')
      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false })

      setMessages((current) => [
        ...current,
        {
          id: makeId('user'),
          role: 'user',
          content: content.trim(),
          timestamp,
        },
      ])
      setError(null)
      setTimelineEvents([])
      setActiveRun({
        id: runId,
        sessionId,
        status: 'connecting',
      })
      setLastRunState('connecting')

      let sawFinal = false

      try {
        await streamChat({
          sessionId,
          message: content.trim(),
          onEvent: ({ eventType, data }) => {
            if (eventType === 'thinking' || eventType === 'tool_call' || eventType === 'tool_result') {
              setActiveRun((current) => {
                if (!current || current.id !== runId) {
                  return current
                }

                return {
                  ...current,
                  status: 'streaming',
                }
              })
              setLastRunState('streaming')
              setTimelineEvents((current) => [
                ...current,
                {
                  id: makeId(eventType),
                  eventType,
                  data,
                  createdAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                },
              ])
              return
            }

            if (eventType !== 'final') {
              return
            }

            if ('content' in data) {
              sawFinal = true
              setActiveRun((current) => {
                if (!current || current.id !== runId) {
                  return current
                }

                return {
                  ...current,
                  status: 'streaming',
                }
              })
              setMessages((current) => [
                ...current,
                {
                  id: makeId('assistant'),
                  role: 'assistant',
                  content: data.content,
                  timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
                },
              ])
              return
            }
          },
        })

        setActiveRun(null)
        setLastRunState(sawFinal ? 'idle' : 'disconnected')
        await refreshSessions()
      } catch (sendError) {
        const message =
          sendError instanceof Error ? sendError.message : '消息发送失败'
        setError(message)
        setActiveRun(null)
        setLastRunState('error')
      }
    },
    [activeRun, currentSession, refreshSessions],
  )

  const deleteSession = useCallback(
    async (session: SessionSummary) => {
      if (activeRun?.status === 'connecting' || activeRun?.status === 'streaming') {
        return
      }

      setDeletingSessionId(session.session_id)
      setError(null)

      try {
        await deleteSessionRequest(session)

        const previousSessions = sessions
        const remainingSessions = previousSessions.filter(
          (item) => item.session_id !== session.session_id,
        )

        setSessions(remainingSessions)

        if (currentSession?.session.session_id !== session.session_id) {
          return
        }

        setActiveRun(null)
        setLastRunState('idle')
        setTimelineEvents([])
        setMessages([])
        setCurrentAgent(null)
        setCurrentSession(null)

        if (remainingSessions.length > 0) {
          const deletedIndex = previousSessions.findIndex(
            (item) => item.session_id === session.session_id,
          )
          const nextIndex = Math.min(
            deletedIndex >= 0 ? deletedIndex : 0,
            remainingSessions.length - 1,
          )
          await openSession(remainingSessions[nextIndex])
          return
        }

        await createNewSession()
      } catch (deleteError) {
        const message =
          deleteError instanceof Error ? deleteError.message : '删除会话失败'
        setError(message)
      } finally {
        setDeletingSessionId(null)
      }
    },
    [activeRun, createNewSession, currentSession, openSession, sessions],
  )

  return {
    sessions,
    currentSession,
    messages,
    timelineEvents,
    currentAgent,
    loadingSessions,
    loadingConversation,
    error,
    activeRun,
    lastRunState,
    deletingSessionId,
    openSession,
    createNewSession,
    sendMessage,
    deleteSession,
  }
}

export function ChatPage() {
  const {
    sessions,
    currentSession,
    messages,
    timelineEvents,
    currentAgent,
    loadingSessions,
    loadingConversation,
    error,
    activeRun,
    lastRunState,
    deletingSessionId,
    openSession,
    createNewSession,
    sendMessage,
    deleteSession,
  } = useChatController()
  const [composerValue, setComposerValue] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionSummary | null>(null)
  const submitComposer = useCallback(() => {
    if (!composerValue.trim()) {
      return
    }

    void sendMessage(composerValue)
    setComposerValue('')
  }, [composerValue, sendMessage])
  const streamState = activeRun?.status ?? lastRunState
  const isStreaming = activeRun?.status === 'connecting' || activeRun?.status === 'streaming'
  const conversationScrollRef = useRef<HTMLDivElement | null>(null)
  const conversationBottomRef = useRef<HTMLDivElement | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)

  const filteredSessions = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase()

    if (!keyword) {
      return sessions
    }

    return sessions.filter(
      (session) =>
        session.session_id.toLowerCase().includes(keyword) ||
        session.chat_id.toLowerCase().includes(keyword),
    )
  }, [searchValue, sessions])

  const { t } = useTranslation()
  const providerName = currentAgent?.provider ?? t('chat.loadingProvider')

  const scrollConversationToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = conversationScrollRef.current
    if (!container) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      })
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [])

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = timelineScrollRef.current
    if (!container) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      })
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => scrollConversationToBottom('auto'), [
    currentSession?.session.session_id,
    scrollConversationToBottom,
  ])

  useEffect(() => scrollConversationToBottom('smooth'), [
    messages.length,
    activeRun?.status,
    scrollConversationToBottom,
  ])

  useEffect(() => scrollTimelineToBottom('smooth'), [
    timelineEvents.length,
    scrollTimelineToBottom,
  ])

  useEffect(() => {
    if (!pendingDeleteSession || deletingSessionId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingDeleteSession(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [deletingSessionId, pendingDeleteSession])

  return (
    <section className="flex h-full min-h-0 overflow-hidden flex-col gap-4">
      {error ? (
        <div className="panel-surface shrink-0 flex items-start gap-3 border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{t('chat.currentIssue')}</p>
            <p className="mt-1 text-[13px] text-[var(--color-danger)]/90">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="panel-surface flex min-h-0 overflow-hidden flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('chat.sessions')}</h2>
              <p className="mt-1 text-[11px] tertiary-text">{t('chat.sessionsHint')}</p>
            </div>
            <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              {sessions.length} total
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              void createNewSession()
            }}
            disabled={isStreaming}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t('chat.newChat')}
          </button>

          <input
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value)
            }}
            placeholder={t('chat.searchSessions')}
            className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />

          <div className="scroll-area min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {loadingSessions ? (
              <SidebarSkeleton />
            ) : filteredSessions.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {filteredSessions.map((session, index) => {
                  const selected = currentSession?.session.session_id === session.session_id
                  const isDeleting = deletingSessionId === session.session_id

                  return (
                    <motion.div
                      key={session.session_id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      className={cn(
                        'group rounded-[var(--radius-md)] border px-3.5 py-2.5 transition-all duration-150',
                        selected
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50 hover:shadow-[var(--shadow-sm)]',
                        (isStreaming || isDeleting) && 'opacity-70',
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isStreaming && !isDeleting) {
                              void openSession(session)
                            }
                          }}
                          disabled={isStreaming || isDeleting}
                          className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                        >
                          <span className="w-full truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                            {session.chat_id}
                          </span>
                          <p className="w-full truncate text-[11px] tertiary-text">{session.session_id}</p>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPendingDeleteSession(session)
                          }}
                          disabled={isStreaming || isDeleting}
                          className="inline-flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-danger)]/40 hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={t('chat.deleteSessionAriaLabel', { id: session.session_id })}
                          title={t('chat.deleteSessionBtnTitle')}
                        >
                          {isDeleting ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 transition-transform hover:-rotate-6" />
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-6 text-sm subtle-text">
                {t('chat.noMatchSessions')}
              </div>
            )}
          </div>
        </aside>

        <section className="panel-surface flex min-h-0 overflow-hidden flex-col">
          <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('chat.conversation')}</h2>
                <p className="mt-1 text-[11px] tertiary-text">
                  {currentSession ? currentSession.session.session_id : t('chat.preparing')}
                </p>
              </div>
              <StreamBadge state={streamState} />
            </div>
          </div>

          <div
            ref={conversationScrollRef}
            className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 py-5"
          >
            <div className="flex min-h-full flex-col gap-4">
              {loadingConversation ? (
                <ConversationSkeleton />
              ) : messages.length > 0 ? (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              ) : (
                <EmptyConversation />
              )}

              {activeRun ? <AssistantLoadingBubble state={activeRun.status} /> : null}
              <div ref={conversationBottomRef} />
            </div>
          </div>

          <div className="shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                submitComposer()
              }}
            >
              <textarea
                rows={2}
                value={composerValue}
                onChange={(event) => {
                  setComposerValue(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submitComposer()
                  }
                }}
                placeholder={t('chat.inputPlaceholder')}
                disabled={!currentSession || isStreaming}
                className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-3 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] subtle-text">
                  {t('chat.webChannelHint')}
                </p>

                <button
                  type="submit"
                  disabled={!currentSession || !composerValue.trim() || isStreaming}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg-app)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--color-text-primary)]/90 hover:shadow-[0_2px_8px_var(--color-border-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isStreaming ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <SendHorizontal className="h-4 w-4" />
                  )}
                  {t('chat.send')}
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside className="panel-surface flex min-h-0 overflow-hidden flex-col p-5">
          <div className="mb-5">
            <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('chat.sessionDetails')}</h2>
            <p className="mt-1 text-[11px] tertiary-text">{t('chat.sessionDetailsHint')}</p>
          </div>

          <div className="space-y-3">
            <KeyValue label="Agent" value={currentSession?.agentName ?? t('chat.waiting')} />
            <KeyValue label="Provider" value={providerName} />
          </div>

          <div className="my-4 h-px bg-[var(--color-bg-active)]" />

          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('chat.eventTimeline')}</h3>
            <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              {timelineEvents.length} events
            </span>
          </div>

          <div
            ref={timelineScrollRef}
            className="scroll-area min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
          >
            {timelineEvents.length > 0 ? (
              timelineEvents.map((event) => <EventCard key={event.id} event={event} />)
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-5 text-sm subtle-text">
                {t('chat.timelineEmpty')}
              </div>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDeleteModal
        session={pendingDeleteSession}
        isBusy={
          pendingDeleteSession !== null && deletingSessionId === pendingDeleteSession.session_id
        }
        onCancel={() => {
          if (!deletingSessionId) {
            setPendingDeleteSession(null)
          }
        }}
        onConfirm={async () => {
          if (!pendingDeleteSession) {
            return
          }

          await deleteSession(pendingDeleteSession)
          setPendingDeleteSession(null)
        }}
      />
    </section>
  )
}

function StreamBadge({ state }: { state: RunStatus }) {
  const meta = {
    idle: {
      icon: CheckCircle2,
      label: 'idle',
      className: 'text-[var(--color-success)]',
    },
    connecting: {
      icon: LoaderCircle,
      label: 'connecting',
      className: 'text-[var(--color-accent)]',
    },
    streaming: {
      icon: Sparkles,
      label: 'streaming',
      className: 'text-[var(--color-thinking)]',
    },
    disconnected: {
      icon: Unplug,
      label: 'disconnected',
      className: 'text-[var(--color-warning)]',
    },
    error: {
      icon: AlertCircle,
      label: 'error',
      className: 'text-[var(--color-danger)]',
    },
  }[state]
  const Icon = meta.icon

  return (
    <div className={cn(
      'inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] tracking-[0.06em] subtle-text transition-colors',
      state === 'streaming' && 'animate-pulse',
    )}>
      <Icon className={cn('h-3.5 w-3.5', meta.className, state === 'connecting' && 'animate-spin')} />
      {meta.label}
    </div>
  )
}

function KeyValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3 transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50">
      <p className="text-[11px] tracking-[0.06em] tertiary-text">{label}</p>
      <p className="mt-1 break-all text-sm text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const align =
    message.role === 'user' ? 'items-end text-right' : 'items-start text-left'
  const bubbleClass =
    message.role === 'user'
      ? 'bg-[var(--color-accent-soft)] border-[var(--color-border-strong)]'
      : 'bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]'

  return (
    <motion.div
      initial={{ opacity: 0, x: message.role === 'user' ? 12 : -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn('flex flex-col gap-2', align)}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-[20px] border px-4 py-3 shadow-[var(--shadow-sm)]',
          bubbleClass,
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] tracking-[0.06em] tertiary-text">
            {message.role === 'user' ? 'You' : 'Assistant'}
          </span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(message.content)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            }}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] px-2 py-1 text-[11px] subtle-text transition hover:bg-[var(--color-bg-active)]/50"
          >
            <Copy className="h-3 w-3" />
            {copied ? t('chat.copied') : t('chat.copy')}
          </button>
        </div>
        <div className="markdown-content text-sm leading-6 text-[var(--color-text-primary)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ ...props }) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noreferrer"
                />
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
      <span className="px-1 text-xs tertiary-text">{formatTimestamp(message.timestamp, t('chat.justNow'))}</span>
    </motion.div>
  )
}

function EventCard({ event }: { event: ChatEventRecord }) {
  const { t } = useTranslation()
  const meta = {
    thinking: {
      label: 'Thinking',
      icon: Brain,
      tone: 'bg-[var(--color-thinking)]/12 text-[var(--color-thinking)]',
    },
    tool_call: {
      label: 'Tool Call',
      icon: Wrench,
      tone: 'bg-[var(--color-tool)]/12 text-[var(--color-tool)]',
    },
    tool_result: {
      label: 'Tool Result',
      icon: Cable,
      tone: 'bg-[var(--color-success)]/12 text-[var(--color-success)]',
    },
  }[event.eventType]
  const Icon = meta.icon
  const toolCallArgs =
    event.eventType === 'tool_call' && 'args' in event.data ? event.data.args : null
  const toolResultText =
    event.eventType === 'tool_result' && 'result' in event.data
      ? event.data.result
      : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 p-3 transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50"
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <motion.span
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium', meta.tone)}
          >
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
          </motion.span>
        </div>
        <span className="text-[11px] tertiary-text">{event.createdAt}</span>
      </div>

      {event.eventType === 'thinking' && 'content' in event.data ? (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6 subtle-text">
          {event.data.content}
        </p>
      ) : null}

      {(event.eventType === 'tool_call' || event.eventType === 'tool_result') &&
      'tool_name' in event.data ? (
        <div className="space-y-2.5">
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-3 py-2">
            <p className="text-[11px] tracking-[0.06em] tertiary-text">Tool</p>
            <p className="mt-1 text-[13px] text-[var(--color-text-primary)]">{event.data.tool_name}</p>
          </div>

          <details className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-3 py-2.5">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-[var(--color-text-primary)]">
              {event.eventType === 'tool_call' ? t('chat.viewArgs') : t('chat.viewResult')}
            </summary>
            <pre className="mt-2.5 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 subtle-text">
              {event.eventType === 'tool_call'
                ? JSON.stringify(toolCallArgs, null, 2)
                : toolResultText}
            </pre>
          </details>
        </div>
      ) : null}
    </motion.div>
  )
}

function ConfirmDeleteModal({
  session,
  isBusy,
  onCancel,
  onConfirm,
}: {
  session: SessionSummary | null
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <AnimatePresence>
      {session ? (
        <motion.div
          key="delete-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => {
            if (!isBusy) {
              onCancel()
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-md p-5 shadow-[var(--shadow-lg)]"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            aria-describedby="delete-session-description"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
        <div className="space-y-2">
          <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Session</p>
          <h3 id="delete-session-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('chat.deleteSessionConfirmTitle')}
          </h3>
          <p id="delete-session-description" className="text-sm subtle-text">
            {t('chat.deleteSessionConfirmDesc')}
          </p>
        </div>

        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
          <p className="text-[11px] tracking-[0.06em] tertiary-text">Chat ID</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{session.chat_id}</p>
          <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Session ID</p>
          <p className="mt-1 break-all text-sm subtle-text">{session.session_id}</p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm()
            }}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {t('chat.deleteSession')}
          </button>
        </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function EmptyConversation() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]">
        <Bot className="h-6 w-6 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('chat.startNew')}</h3>
        <p className="max-w-lg text-sm subtle-text">
          {t('chat.startNewHint')}
        </p>
      </div>
    </div>
  )
}

function AssistantLoadingBubble({ state }: { state: RunStatus }) {
  const { t } = useTranslation()
  const label = state === 'connecting' ? t('chat.connecting') : t('chat.streaming')

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[80%] rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-4 shadow-[var(--shadow-sm)]">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] tracking-[0.06em] tertiary-text">Assistant</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-2.5 py-1 text-[11px] subtle-text">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--color-accent)]" />
            Thinking
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm subtle-text">
          <span className="flex gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)] [animation-delay:0ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)] [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)] [animation-delay:300ms]" />
          </span>
          {label}
        </div>
      </div>
      <span className="px-1 text-xs tertiary-text">{t('chat.waitingReply')}</span>
    </div>
  )
}

function SidebarSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-4"
        >
          <div className="h-4 w-20 rounded bg-[var(--color-bg-active)]" />
          <div className="mt-3 h-3 w-32 rounded bg-[var(--color-bg-hover)]/60" />
        </div>
      ))}
    </div>
  )
}

function ConversationSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            'animate-pulse rounded-[20px] border border-[var(--color-border-subtle)] px-4 py-4',
            index % 2 === 0 ? 'ml-auto max-w-[72%] bg-[var(--color-bg-active)]/50' : 'max-w-[80%] bg-[var(--color-bg-hover)]/50',
          )}
        >
          <div className="h-3 w-16 rounded bg-[var(--color-bg-active)]" />
          <div className="mt-4 h-3 w-56 rounded bg-[var(--color-bg-hover)]/60" />
          <div className="mt-2 h-3 w-44 rounded bg-[var(--color-bg-hover)]/60" />
        </div>
      ))}
    </div>
  )
}
