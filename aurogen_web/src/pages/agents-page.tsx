import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  FileText,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Shield,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type AgentInstance = {
  key: string
  builtin: boolean
  name: string
  description: string
  provider: string
  emoji: string
}

type ProviderOption = {
  key: string
  type: string
  description: string
  model: string
}

type ChannelRef = {
  key: string
  agent_name: string
}

type SkillEntry = {
  name: string
  description: string
  source: string
  agent_name: string | null
  available: boolean
}

type AgentFormData = {
  name: string
  display_name: string
  description: string
  provider: string
  emoji: string
}

const EMOJI_PALETTE = [
  '🧠', '🤖', '⚡', '✨', '🚀', '🔥', '💡', '🌈', '🌍', '🎯',
  '🔮', '💫', '🧊', '💎', '🌟', '🐍', '🐻', '🦅', '🦙', '👾',
  '🎨', '🔒', '🛠️', '📡', '👥', '🐾', '🐱', '🦁', '🐺', '🦊',
  '🐸', '🦋', '🐝', '🦄', '🐳', '🐙', '🦑', '🦖', '🐲', '🦜',
  '😎', '🥳', '🤩', '😈', '👻', '💀', '🎃', '🤠', '🥷', '🧙',
  '🌸', '🍀', '🌵', '🍄', '🌙', '☀️', '🌊', '❄️', '🔔', '🎵',
  '🎮', '🕹️', '📱', '💻', '🖥️', '⌨️', '🧲', '🔬', '🧪', '💊',
]

function getDisplayEmoji(agent: AgentInstance): string {
  return agent.emoji || '\u{1F43E}'
}

async function fetchAgents() {
  return fetchJson<{ agents: AgentInstance[] }>('/agents')
}

async function fetchProviderOptions() {
  const res = await fetchJson<{ providers: { key: string; type: string; description: string; model: string }[] }>('/providers/config')
  return res.providers.map((p) => ({ key: p.key, type: p.type, description: p.description, model: p.model }))
}

async function fetchChannelRefs() {
  const res = await fetchJson<{ channels: { key: string; agent_name: string }[] }>('/channels/config')
  return res.channels
}

async function fetchAgentSkills(agentKey: string) {
  return fetchJson<{ skills: SkillEntry[] }>(`/skills?agent_name=${encodeURIComponent(agentKey)}`)
}

async function fetchAgentFiles(agentKey: string) {
  return fetchJson<{ files: string[] }>(`/agents/${encodeURIComponent(agentKey)}/files`)
}

async function fetchAgentFile(agentKey: string, filename: string) {
  return fetchJson<{ filename: string; content: string }>(`/agents/${encodeURIComponent(agentKey)}/files/${encodeURIComponent(filename)}`)
}

async function saveAgentFile(agentKey: string, filename: string, content: string) {
  return fetchJson<{ message: string }>(`/agents/${encodeURIComponent(agentKey)}/files/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

async function addAgent(data: AgentFormData) {
  return fetchJson<{ message: string }>('/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function updateAgent(
  name: string,
  data: { display_name?: string; description?: string; provider?: string; emoji?: string },
) {
  return fetchJson<{ message: string }>(`/agents/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function deleteAgent(name: string) {
  return fetchJson<{ message: string }>(`/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

function getAgentChannels(agentKey: string, channels: ChannelRef[]): string[] {
  return channels.filter((ch) => ch.agent_name === agentKey).map((ch) => ch.key)
}

function useAgentsController() {
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([])
  const [channelRefs, setChannelRefs] = useState<ChannelRef[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectedAgent = useMemo(
    () => agents.find((a) => a.key === selectedKey) ?? null,
    [agents, selectedKey],
  )

  const reload = useCallback(async () => {
    try {
      const [agentsRes, providers, channels] = await Promise.all([
        fetchAgents(),
        fetchProviderOptions(),
        fetchChannelRefs(),
      ])
      setAgents(agentsRes.agents)
      setProviderOptions(providers)
      setChannelRefs(channels)
      return agentsRes.agents
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load claws'
      setError(msg)
      return []
    }
  }, [])

  useEffect(() => {
    let active = true
    async function init() {
      setLoading(true)
      await reload()
      if (!active) return
      setLoading(false)
    }
    void init()
    return () => { active = false }
  }, [reload])

  const handleAdd = useCallback(async (data: AgentFormData) => {
    setSaving(true)
    setError(null)
    try {
      await addAgent(data)
      const list = await reload()
      setSelectedKey(data.name)
      return list
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add claw'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleUpdate = useCallback(async (
    name: string,
    data: { display_name?: string; description?: string; provider?: string; emoji?: string },
  ) => {
    setSaving(true)
    setError(null)
    try {
      await updateAgent(name, data)
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update claw'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleDelete = useCallback(async (name: string) => {
    setDeleting(true)
    setError(null)
    try {
      await deleteAgent(name)
      const list = await reload()
      if (selectedKey === name) {
        setSelectedKey(list.length > 0 ? list[0].key : null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete claw'
      setError(msg)
      throw err
    } finally {
      setDeleting(false)
    }
  }, [reload, selectedKey])

  return {
    agents,
    providerOptions,
    channelRefs,
    selectedKey,
    selectedAgent,
    loading,
    error,
    saving,
    deleting,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
  }
}

export function AgentsPage() {
  const { t } = useTranslation()
  const {
    agents,
    providerOptions,
    channelRefs,
    selectedKey,
    selectedAgent,
    loading,
    error,
    saving,
    deleting,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
  } = useAgentsController()

  const [searchValue, setSearchValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const drawerOpen = selectedKey !== null

  const filteredAgents = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return agents
    return agents.filter(
      (a) =>
        a.key.toLowerCase().includes(kw) ||
        a.name.toLowerCase().includes(kw) ||
        a.provider.toLowerCase().includes(kw),
    )
  }, [searchValue, agents])

  const closeDrawer = () => {
    setSelectedKey(null)
    setEditMode(false)
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      {error ? (
        <div className="panel-surface flex items-start gap-3 border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-5 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t('common.operationError')}</p>
            <p className="mt-1 text-[13px] text-[var(--color-danger)]/90">{error}</p>
          </div>
          <button type="button" onClick={() => setError(null)} className="shrink-0 p-1 transition hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="panel-surface flex items-center gap-3 px-5 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t('claws.search')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </div>
        <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
          {agents.length} total
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-4 py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)]"
        >
          <Plus className="h-4 w-4" />
          New Claw
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="scroll-area h-full overflow-y-auto p-1">
          {loading ? (
            <CardGridSkeleton />
          ) : filteredAgents.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {filteredAgents.map((agent, index) => {
                  const selected = selectedKey === agent.key
                  const channelCount = getAgentChannels(agent.key, channelRefs).length
                  return (
                    <motion.button
                      key={agent.key}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      onClick={() => {
                        setSelectedKey(agent.key)
                        setEditMode(false)
                      }}
                      className={cn(
                        'group flex w-full flex-col rounded-[var(--radius-md)] border p-4 text-left transition-all duration-150',
                        selected
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] shadow-[var(--shadow-sm)]'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50 hover:shadow-[var(--shadow-sm)]',
                      )}
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <span className="text-2xl leading-none" role="img">
                          {getDisplayEmoji(agent)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {agent.builtin ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                              <Shield className="h-2.5 w-2.5" />
                              builtin
                            </span>
                          ) : null}
                          {channelCount > 0 ? (
                            <span className="shrink-0 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-2 py-0.5 text-[10px] tertiary-text">
                              {channelCount} ch
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                        {agent.key}
                      </p>
                      <p className="mt-1 truncate text-[11px] tertiary-text">
                        {agent.name}{agent.provider ? ` \u00B7 ${agent.provider}` : ''}
                      </p>
                      {agent.description ? (
                        <p className="mt-2 line-clamp-2 text-[11px] subtle-text">
                          {agent.description}
                        </p>
                      ) : null}
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-6 py-8 text-center text-sm subtle-text">
                {agents.length === 0
                  ? t('claws.emptyNoConfig')
                  : t('claws.emptyNoMatch')}
              </div>
            </div>
          )}
        </div>

        <ClawDrawer
          open={drawerOpen}
          agent={selectedAgent}
          providerOptions={providerOptions}
          channelRefs={channelRefs}
          editMode={editMode}
          saving={saving}
          onClose={closeDrawer}
          onEdit={() => setEditMode(true)}
          onCancelEdit={() => setEditMode(false)}
          onSave={async (data) => {
            if (!selectedAgent) return
            await handleUpdate(selectedAgent.key, data)
            setEditMode(false)
          }}
          onDelete={() => {
            if (selectedAgent) setPendingDeleteKey(selectedAgent.key)
          }}
        />
      </div>

      <AddClawModal
        open={showAddModal}
        providerOptions={providerOptions}
        saving={saving}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (data) => {
          await handleAdd(data)
          setShowAddModal(false)
        }}
      />

      <ConfirmDeleteModal
        agentKey={pendingDeleteKey}
        agent={pendingDeleteKey ? agents.find((a) => a.key === pendingDeleteKey) ?? null : null}
        usedByChannels={pendingDeleteKey ? getAgentChannels(pendingDeleteKey, channelRefs) : []}
        isBusy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDeleteKey(null)
        }}
        onConfirm={async () => {
          if (!pendingDeleteKey) return
          try {
            await handleDelete(pendingDeleteKey)
            setPendingDeleteKey(null)
            closeDrawer()
          } catch {
            /* error already set */
          }
        }}
      />
    </section>
  )
}

// ── Drawer ──────────────────────────────────────────────────────────────────────

function ClawDrawer({
  open,
  agent,
  providerOptions,
  channelRefs,
  editMode,
  saving,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  open: boolean
  agent: AgentInstance | null
  providerOptions: ProviderOption[]
  channelRefs: ChannelRef[]
  editMode: boolean
  saving: boolean
  onClose: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (data: { display_name?: string; description?: string; provider?: string; emoji?: string }) => Promise<void>
  onDelete: () => void
}) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && agent ? (
        <motion.aside
          key="drawer-panel"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[640px] flex-col rounded-l-[var(--radius-lg)] border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] shadow-[var(--shadow-lg)]"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xl" role="img">{getDisplayEmoji(agent)}</span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{agent.key}</p>
                  {agent.builtin ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                      <Shield className="h-2.5 w-2.5" />
                      builtin
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] tertiary-text">{agent.name}{agent.provider ? ` \u00B7 ${agent.provider}` : ''}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {editMode ? (
              <ClawEditor
                agent={agent}
                providerOptions={providerOptions}
                saving={saving}
                onSave={onSave}
                onCancel={onCancelEdit}
              />
            ) : (
              <ClawDetail
                agent={agent}
                channelRefs={channelRefs}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

// ── Detail ──────────────────────────────────────────────────────────────────────

function ClawDetail({
  agent,
  channelRefs,
  onEdit,
  onDelete,
}: {
  agent: AgentInstance
  channelRefs: ChannelRef[]
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const usedByChannels = getAgentChannels(agent.key, channelRefs)
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'detail' | 'workspace'>('detail')
  const [files, setFiles] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileSaving, setFileSaving] = useState(false)
  const [fileDirty, setFileDirty] = useState(false)

  useEffect(() => {
    let active = true
    setSkillsLoading(true)
    fetchAgentSkills(agent.key)
      .then((res) => { if (active) setSkills(res.skills) })
      .catch(() => { if (active) setSkills([]) })
      .finally(() => { if (active) setSkillsLoading(false) })
    return () => { active = false }
  }, [agent.key])

  useEffect(() => {
    let active = true
    fetchAgentFiles(agent.key)
      .then((res) => {
        if (!active) return
        setFiles(res.files)
        if (res.files.length > 0 && !activeFile) {
          setActiveFile(res.files[0])
        }
      })
      .catch(() => { if (active) setFiles([]) })
    return () => { active = false }
  }, [agent.key, activeFile])

  useEffect(() => {
    if (!activeFile || activeTab !== 'workspace') return
    let active = true
    setFileLoading(true)
    setFileDirty(false)
    fetchAgentFile(agent.key, activeFile)
      .then((res) => { if (active) setFileContent(res.content) })
      .catch(() => { if (active) setFileContent('') })
      .finally(() => { if (active) setFileLoading(false) })
    return () => { active = false }
  }, [agent.key, activeFile, activeTab])

  const handleSaveFile = async () => {
    if (!activeFile) return
    setFileSaving(true)
    try {
      await saveAgentFile(agent.key, activeFile, fileContent)
      setFileDirty(false)
    } catch {
      /* ignore */
    } finally {
      setFileSaving(false)
    }
  }

  return (
    <motion.div
      key={agent.key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('detail')}
            className={cn(
              'rounded-[var(--radius-sm)] px-3 py-1 text-[12px] font-medium transition',
              activeTab === 'detail'
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            Detail
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('workspace')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1 text-[12px] font-medium transition',
              activeTab === 'workspace'
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            <FileText className="h-3 w-3" />
            {t('claws.workspace')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
          >
            {t('common.edit')}
          </button>
          {!agent.builtin ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20"
            >
              {t('common.delete')}
            </button>
          ) : null}
        </div>
      </div>

      {activeTab === 'detail' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <DetailField label="Key" value={agent.key} />
            <DetailField label="Display Name" value={agent.name || '\u2014'} />
            <DetailField label="Brain" value={agent.provider || '\u2014'} />
          </div>

          {agent.description ? (
            <DetailField label="Description" value={agent.description} />
          ) : null}

          {usedByChannels.length > 0 ? (
            <div>
              <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-text-primary)]">{t('claws.channels')}</h3>
              <div className="flex flex-wrap gap-2">
                {usedByChannels.map((ch) => (
                  <span
                    key={ch}
                    className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)]"
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-text-primary)]">{t('claws.skills')}</h3>
            {skillsLoading ? (
              <div className="text-[12px] subtle-text">{t('common.loading')}</div>
            ) : skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <span
                    key={skill.name}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px]',
                      skill.available
                        ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 text-[var(--color-text-primary)]'
                        : 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[var(--color-warning)]',
                    )}
                  >
                    {skill.name}
                    <span className="text-[10px] tertiary-text">{skill.source}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12px] subtle-text">No skills</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1 overflow-x-auto">
              {files.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setActiveFile(f); setFileDirty(false) }}
                  className={cn(
                    'shrink-0 rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-medium transition',
                    activeFile === f
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            {activeFile ? (
              <button
                type="button"
                onClick={() => { void handleSaveFile() }}
                disabled={fileSaving || !fileDirty}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fileSaving ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {fileSaving ? t('claws.saving') : t('common.save')}
              </button>
            ) : null}
          </div>

          {fileLoading ? (
            <div className="flex h-40 items-center justify-center text-[12px] subtle-text">{t('common.loading')}</div>
          ) : activeFile ? (
            <textarea
              value={fileContent}
              onChange={(e) => { setFileContent(e.target.value); setFileDirty(true) }}
              className="h-[400px] w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
          ) : (
            <p className="text-[12px] subtle-text">{t('claws.noFiles')}</p>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────────

function ClawEditor({
  agent,
  providerOptions,
  saving,
  onSave,
  onCancel,
}: {
  agent: AgentInstance
  providerOptions: ProviderOption[]
  saving: boolean
  onSave: (data: {
    display_name?: string
    description?: string
    provider?: string
    emoji?: string
  }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [displayName, setDisplayName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description)
  const [provider, setProvider] = useState(agent.provider)
  const [emoji, setEmoji] = useState(agent.emoji)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: {
      display_name?: string
      description?: string
      provider?: string
      emoji?: string
    } = {}

    if (displayName !== agent.name) payload.display_name = displayName
    if (description !== agent.description) payload.description = description
    if (provider !== agent.provider) payload.provider = provider
    if (emoji !== agent.emoji) payload.emoji = emoji

    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }

    await onSave(payload)
  }

  return (
    <motion.form
      key={`edit-${agent.key}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <div>
            <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('claws.editClaw')}</p>
            <div className="mt-1 flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{agent.key}</h2>
              {agent.builtin ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                  <Shield className="h-2.5 w-2.5" />
                  builtin
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Display Name *">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('claws.displayNamePlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="Brain *">
          <div className="relative">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 pr-8 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            >
              {providerOptions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key}{p.model ? ` \u00B7 ${p.model}` : ''} ({p.type})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          </div>
        </FormField>
        <FormField label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('claws.descriptionPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>
    </motion.form>
  )
}

// ── Add Modal ───────────────────────────────────────────────────────────────────

function AddClawModal({
  open,
  providerOptions,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  providerOptions: ProviderOption[]
  saving: boolean
  onClose: () => void
  onSubmit: (data: AgentFormData) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState('')
  const [emoji, setEmoji] = useState('')

  useEffect(() => {
    if (open && providerOptions.length > 0 && !provider) {
      setProvider(providerOptions[0].key)
    }
  }, [open, providerOptions, provider])

  useEffect(() => {
    if (!open) {
      setName('')
      setDisplayName('')
      setDescription('')
      setProvider(providerOptions.length > 0 ? providerOptions[0].key : '')
      setEmoji('')
    }
  }, [open, providerOptions])

  const canSubmit = name.trim() && displayName.trim() && provider

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit({
      name: name.trim(),
      display_name: displayName.trim(),
      description: description.trim(),
      provider,
      emoji,
    })
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="add-claw-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => { if (!saving) onClose() }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-lg p-6 shadow-[var(--shadow-lg)]"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-5">
              <div>
                <p className="text-[11px] tracking-[0.06em] tertiary-text">New Claw</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('claws.newClawTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('claws.newClawDesc')}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <EmojiPicker value={emoji} onChange={setEmoji} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Name (Key) *">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('claws.keyPlaceholder')}
                    autoFocus
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Display Name *">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('claws.displayNameNewPlaceholder')}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
              </div>

              <FormField label="Description">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('claws.descNewPlaceholder')}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>

              <FormField label="Brain *">
                <div className="relative">
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  >
                    {providerOptions.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.key}{p.model ? ` \u00B7 ${p.model}` : ''} ({p.type})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                </div>
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !canSubmit}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t('common.create')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ── Delete Modal ────────────────────────────────────────────────────────────────

function ConfirmDeleteModal({
  agentKey,
  agent,
  usedByChannels,
  isBusy,
  onCancel,
  onConfirm,
}: {
  agentKey: string | null
  agent: AgentInstance | null
  usedByChannels: string[]
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!agentKey || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [agentKey, isBusy, onCancel])

  const isBuiltin = agent?.builtin ?? false
  const hasChannels = usedByChannels.length > 0

  return (
    <AnimatePresence>
      {agentKey ? (
        <motion.div
          key="delete-claw-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => { if (!isBusy) onCancel() }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-md p-5 shadow-[var(--shadow-lg)]"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Claw</p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('claws.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('claws.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Claw Key</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{agentKey}</p>
              {agent ? (
                <>
                  <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Display Name</p>
                  <p className="mt-1 text-sm subtle-text">{agent.name}</p>
                </>
              ) : null}
            </div>

            {isBuiltin ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('claws.builtinCannotDelete')}
                </p>
              </div>
            ) : null}

            {!isBuiltin && hasChannels ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('claws.usedByChannelsWarning')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {usedByChannels.map((ch) => (
                    <span key={ch} className="rounded-full border border-[color:var(--color-warning)]/30 px-2.5 py-1 text-[11px] text-[var(--color-warning)]">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={isBusy}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              {!isBuiltin ? (
                <button
                  type="button"
                  onClick={() => { void onConfirm() }}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {t('common.delete')}
                </button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ── EmojiPicker ─────────────────────────────────────────────────────────────────

function EmojiPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (emoji: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-10 items-center gap-2.5 rounded-[var(--radius-sm)] border px-3 text-[13px] transition',
          'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] hover:border-[var(--color-border-strong)]',
        )}
      >
        <span className="text-xl leading-none">{value || '\u{1F43E}'}</span>
        <span className="tertiary-text">{value ? 'Change' : 'Pick emoji'}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-30 mt-1.5 w-[19.5rem] max-w-[min(19.5rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] p-3 shadow-[var(--shadow-lg)]"
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                type="text"
                value={value}
                onChange={(e) => {
                  const val = e.target.value
                  const emojiMatch = val.match(/\p{Extended_Pictographic}/u)
                  if (emojiMatch) {
                    onChange(emojiMatch[0])
                  } else if (val === '') {
                    onChange('')
                  }
                }}
                placeholder="Type or paste emoji"
                className="w-32 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-2.5 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)]"
              />
              {value ? (
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false) }}
                  className="rounded-[var(--radius-sm)] p-1 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="max-h-[240px] overflow-y-auto overflow-x-hidden pr-1">
              <div className="grid grid-cols-6 gap-2.5">
              {EMOJI_PALETTE.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => { onChange(em); setOpen(false) }}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] text-xl transition hover:bg-[var(--color-bg-active)]',
                    value === em && 'bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-border-strong)]',
                  )}
                >
                  {em}
                </button>
              ))}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// ── Shared Components ───────────────────────────────────────────────────────────

function DetailField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3 py-2 transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50">
      <p className="text-[11px] tracking-[0.06em] tertiary-text">{label}</p>
      <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function FormField({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] tracking-[0.06em] tertiary-text">{label}</span>
      {children}
    </label>
  )
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] p-4"
        >
          <div className="mb-3 h-7 w-7 rounded bg-[var(--color-bg-active)]" />
          <div className="h-4 w-24 rounded bg-[var(--color-bg-active)]" />
          <div className="mt-2 h-3 w-32 rounded bg-[var(--color-bg-hover)]/60" />
          <div className="mt-3 h-3 w-full rounded bg-[var(--color-bg-hover)]/40" />
        </div>
      ))}
    </div>
  )
}
