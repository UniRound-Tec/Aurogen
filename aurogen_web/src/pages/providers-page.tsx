import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  Search,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type ThinkingLevel = 'none' | 'low' | 'medium' | 'high'

type SupportedProviderType = {
  type: string
  description: string
  required_settings: string[]
  optional_settings: string[]
}

type ProviderInstance = {
  key: string
  type: string
  description: string
  settings: Record<string, unknown>
  model: string
  memory_window: number
  thinking: ThinkingLevel
  emoji: string
  used_by_agents: string[]
}

type ProviderFormData = {
  key: string
  type: string
  description: string
  settings: Record<string, string>
  model: string
  memory_window: number
  thinking: ThinkingLevel
  emoji: string
}

const SENSITIVE_KEYS = ['api_key', 'app_secret', 'secret', 'token', 'password']

function isSensitiveKey(key: string) {
  return SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))
}

function maskValue(value: unknown): string {
  const str = String(value ?? '')
  if (str.length <= 8) return '••••••••'
  return str.slice(0, 4) + '••••' + str.slice(-4)
}

const DEFAULT_TYPE_EMOJI: Record<string, string> = {
  openai: '\u{1F7E2}',
  openai_custom: '\u{1F536}',
  anthropic: '\u{1F9E0}',
  azure: '\u{2601}\uFE0F',
  ollama: '\u{1F999}',
  openrouter: '\u{1F500}',
  xai: '\u{26A1}',
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

function getDisplayEmoji(provider: ProviderInstance): string {
  if (provider.emoji) return provider.emoji
  return DEFAULT_TYPE_EMOJI[provider.type] ?? '\u{1F9E0}'
}

async function fetchProviders() {
  return fetchJson<{ providers: ProviderInstance[] }>('/providers/config')
}

async function fetchSupportedTypes() {
  return fetchJson<{ supported: SupportedProviderType[] }>('/providers/supported')
}

async function addProvider(data: ProviderFormData) {
  return fetchJson<{ message: string }>('/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function updateProvider(key: string, data: { type?: string; description?: string; settings?: Record<string, string>; model?: string; memory_window?: number; thinking?: ThinkingLevel; emoji?: string }) {
  return fetchJson<{ message: string }>(`/providers/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function deleteProvider(key: string) {
  return fetchJson<{ message: string }>(`/providers/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

async function testProvider(key: string) {
  return fetchJson<{ ok: boolean; reply?: string; error?: string }>(`/providers/${encodeURIComponent(key)}/test`, {
    method: 'POST',
  })
}

function useProvidersController() {
  const [providers, setProviders] = useState<ProviderInstance[]>([])
  const [supportedTypes, setSupportedTypes] = useState<SupportedProviderType[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectedProvider = useMemo(
    () => providers.find((p) => p.key === selectedKey) ?? null,
    [providers, selectedKey],
  )

  const selectedTypeInfo = useMemo(() => {
    if (!selectedProvider) return null
    return supportedTypes.find((t) => t.type === selectedProvider.type) ?? null
  }, [selectedProvider, supportedTypes])

  const reload = useCallback(async () => {
    try {
      const [provRes, typeRes] = await Promise.all([fetchProviders(), fetchSupportedTypes()])
      setProviders(provRes.providers)
      setSupportedTypes(typeRes.supported)
      return provRes.providers
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load brains'
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

  const handleAdd = useCallback(async (data: ProviderFormData) => {
    setSaving(true)
    setError(null)
    try {
      await addProvider(data)
      const list = await reload()
      setSelectedKey(data.key)
      return list
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add brain'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleUpdate = useCallback(async (key: string, data: { type?: string; description?: string; settings?: Record<string, string>; model?: string; memory_window?: number; thinking?: ThinkingLevel; emoji?: string }) => {
    setSaving(true)
    setError(null)
    try {
      await updateProvider(key, data)
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update brain'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleDelete = useCallback(async (key: string) => {
    setDeleting(true)
    setError(null)
    try {
      await deleteProvider(key)
      const list = await reload()
      if (selectedKey === key) {
        setSelectedKey(list.length > 0 ? list[0].key : null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete brain'
      setError(msg)
      throw err
    } finally {
      setDeleting(false)
    }
  }, [reload, selectedKey])

  return {
    providers,
    supportedTypes,
    selectedKey,
    selectedProvider,
    selectedTypeInfo,
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

export function ProvidersPage() {
  const { t } = useTranslation()
  const {
    providers,
    supportedTypes,
    selectedKey,
    selectedProvider,
    selectedTypeInfo,
    loading,
    error,
    saving,
    deleting,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
  } = useProvidersController()

  const [searchValue, setSearchValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const drawerOpen = selectedKey !== null

  const filteredProviders = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return providers
    return providers.filter(
      (p) =>
        p.key.toLowerCase().includes(kw) ||
        p.type.toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw),
    )
  }, [searchValue, providers])

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
            placeholder={t('brains.search')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </div>
        <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
          {providers.length} total
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-4 py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)]"
        >
          <Plus className="h-4 w-4" />
          New Brain
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="scroll-area h-full overflow-y-auto p-1">
          {loading ? (
            <CardGridSkeleton />
          ) : filteredProviders.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {filteredProviders.map((provider, index) => {
                  const selected = selectedKey === provider.key
                  return (
                    <motion.button
                      key={provider.key}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      onClick={() => {
                        setSelectedKey(provider.key)
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
                          {getDisplayEmoji(provider)}
                        </span>
                        {provider.used_by_agents.length > 0 ? (
                          <span className="shrink-0 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-2 py-0.5 text-[10px] tertiary-text">
                            {provider.used_by_agents.length} agent{provider.used_by_agents.length > 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                        {provider.key}
                      </p>
                      <p className="mt-1 truncate text-[11px] tertiary-text">
                        {provider.type}{provider.model ? ` \u00B7 ${provider.model}` : ''}
                      </p>
                      {provider.description ? (
                        <p className="mt-2 line-clamp-2 text-[11px] subtle-text">
                          {provider.description}
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
                {providers.length === 0
                  ? t('brains.emptyNoConfig')
                  : t('brains.emptyNoMatch')}
              </div>
            </div>
          )}
        </div>

        <BrainDrawer
          open={drawerOpen}
          provider={selectedProvider}
          typeInfo={selectedTypeInfo}
          supportedTypes={supportedTypes}
          editMode={editMode}
          saving={saving}
          onClose={closeDrawer}
          onEdit={() => setEditMode(true)}
          onCancelEdit={() => setEditMode(false)}
          onSave={async (data) => {
            if (!selectedProvider) return
            await handleUpdate(selectedProvider.key, data)
            setEditMode(false)
          }}
          onDelete={() => {
            if (selectedProvider) setPendingDeleteKey(selectedProvider.key)
          }}
        />
      </div>

      <AddBrainModal
        open={showAddModal}
        supportedTypes={supportedTypes}
        saving={saving}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (data) => {
          await handleAdd(data)
          setShowAddModal(false)
        }}
      />

      <ConfirmDeleteModal
        providerKey={pendingDeleteKey}
        provider={pendingDeleteKey ? providers.find((p) => p.key === pendingDeleteKey) ?? null : null}
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
            /* error already set in controller */
          }
        }}
      />
    </section>
  )
}

// ── Drawer ──────────────────────────────────────────────────────────────────────

function BrainDrawer({
  open,
  provider,
  typeInfo,
  supportedTypes,
  editMode,
  saving,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  open: boolean
  provider: ProviderInstance | null
  typeInfo: SupportedProviderType | null
  supportedTypes: SupportedProviderType[]
  editMode: boolean
  saving: boolean
  onClose: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (data: { type?: string; description?: string; settings?: Record<string, string>; model?: string; memory_window?: number; thinking?: ThinkingLevel; emoji?: string }) => Promise<void>
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
      {open && provider ? (
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
                <span className="text-xl" role="img">{getDisplayEmoji(provider)}</span>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{provider.key}</p>
                  <p className="text-[11px] tertiary-text">{provider.type}{provider.model ? ` \u00B7 ${provider.model}` : ''}</p>
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
                <ProviderEditor
                  provider={provider}
                  typeInfo={typeInfo}
                  supportedTypes={supportedTypes}
                  saving={saving}
                  onSave={onSave}
                  onCancel={onCancelEdit}
                />
              ) : (
                <ProviderDetail
                  provider={provider}
                  typeInfo={typeInfo}
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

function ProviderDetail({
  provider,
  typeInfo,
  onEdit,
  onDelete,
}: {
  provider: ProviderInstance
  typeInfo: SupportedProviderType | null
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; reply?: string; error?: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testProvider(provider.key)
      setTestResult(res)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setTesting(false)
    }
  }

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allSettingKeys = useMemo(() => {
    const fromType = [...(typeInfo?.required_settings ?? []), ...(typeInfo?.optional_settings ?? [])]
    const fromData = Object.keys(provider.settings)
    return [...new Set([...fromType, ...fromData])]
  }, [typeInfo, provider.settings])

  return (
    <motion.div
      key={provider.key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { void handleTest() }}
          disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {testing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Test
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
        >
          {t('common.edit')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20"
        >
          {t('common.delete')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DetailField label="Key" value={provider.key} />
        <DetailField label="Type" value={provider.type} />
        <DetailField label="Description" value={provider.description || '\u2014'} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DetailField label="Model" value={provider.model || '\u2014'} />
        <DetailField label="Memory Window" value={String(provider.memory_window)} />
        <DetailField label="Thinking" value={provider.thinking} />
      </div>

      {allSettingKeys.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-text-primary)]">Settings</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {allSettingKeys.map((key) => {
              const value = provider.settings[key]
              const sensitive = isSensitiveKey(key)
              const revealed = revealedKeys.has(key)
              const isRequired = typeInfo?.required_settings.includes(key)

              return (
                <div
                  key={key}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] tracking-[0.06em] tertiary-text">
                      {key}
                      {isRequired ? <span className="ml-1 text-[var(--color-accent)]">*</span> : null}
                    </p>
                    {sensitive && value ? (
                      <button
                        type="button"
                        onClick={() => toggleReveal(key)}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] tertiary-text transition hover:bg-[var(--color-bg-active)]"
                      >
                        {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {revealed ? t('brains.hide') : t('brains.show')}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 break-all text-[13px] font-mono text-[var(--color-text-primary)]">
                    {value == null || value === '' ? (
                      <span className="tertiary-text">{t('brains.unset')}</span>
                    ) : sensitive && !revealed ? (
                      maskValue(value)
                    ) : (
                      String(value)
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-[13px] subtle-text">{t('brains.noSettings')}</p>
      )}

      {provider.used_by_agents.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-text-primary)]">Used By Agents</h3>
          <div className="flex flex-wrap gap-2">
            {provider.used_by_agents.map((agent) => (
              <span
                key={agent}
                className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)]"
              >
                {agent}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {testResult ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'overflow-hidden rounded-[var(--radius-sm)] border px-3 py-2.5',
              testResult.ok
                ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10'
                : 'border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10',
            )}
          >
            <div className="flex items-start gap-2">
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn('text-[12px] font-medium', testResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
                  {testResult.ok ? 'Connected' : 'Failed'}
                </p>
                {testResult.ok && testResult.reply ? (
                  <p className="mt-1 line-clamp-3 text-[12px] text-[var(--color-text-secondary)]">{testResult.reply}</p>
                ) : null}
                {!testResult.ok && testResult.error ? (
                  <p className="mt-1 line-clamp-3 break-all text-[12px] text-[var(--color-danger)]/80">{testResult.error}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setTestResult(null)}
                className="shrink-0 p-0.5 transition hover:opacity-70"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────────

function ProviderEditor({
  provider,
  typeInfo,
  supportedTypes,
  saving,
  onSave,
  onCancel,
}: {
  provider: ProviderInstance
  typeInfo: SupportedProviderType | null
  supportedTypes: SupportedProviderType[]
  saving: boolean
  onSave: (data: { type?: string; description?: string; settings?: Record<string, string>; model?: string; memory_window?: number; thinking?: ThinkingLevel; emoji?: string }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState(provider.type)
  const [description, setDescription] = useState(provider.description)
  const [model, setModel] = useState(provider.model ?? '')
  const [memoryWindow, setMemoryWindow] = useState(String(provider.memory_window ?? 100))
  const [thinking, setThinking] = useState<ThinkingLevel>(provider.thinking ?? 'none')
  const [emoji, setEmoji] = useState(provider.emoji ?? '')
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {}
    for (const [k, v] of Object.entries(provider.settings)) {
      s[k] = String(v ?? '')
    }
    return s
  })
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const currentTypeInfo = useMemo(
    () => supportedTypes.find((t) => t.type === type) ?? typeInfo,
    [type, supportedTypes, typeInfo],
  )

  const allSettingKeys = useMemo(() => {
    const fromType = [...(currentTypeInfo?.required_settings ?? []), ...(currentTypeInfo?.optional_settings ?? [])]
    const fromData = Object.keys(settings)
    return [...new Set([...fromType, ...fromData])]
  }, [currentTypeInfo, settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: { type?: string; description?: string; settings?: Record<string, string>; model?: string; memory_window?: number; thinking?: ThinkingLevel; emoji?: string } = {}
    if (type !== provider.type) payload.type = type
    if (description !== provider.description) payload.description = description
    if (model !== (provider.model ?? '')) payload.model = model
    const mw = parseInt(memoryWindow, 10)
    if (!isNaN(mw) && mw !== provider.memory_window) payload.memory_window = mw
    if (thinking !== provider.thinking) payload.thinking = thinking
    if (emoji !== (provider.emoji ?? '')) payload.emoji = emoji

    const filteredSettings: Record<string, string> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (v !== '') filteredSettings[k] = v
    }
    const origSettings: Record<string, string> = {}
    for (const [k, v] of Object.entries(provider.settings)) {
      origSettings[k] = String(v ?? '')
    }
    if (JSON.stringify(filteredSettings) !== JSON.stringify(origSettings)) {
      payload.settings = filteredSettings
    }

    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }

    await onSave(payload)
  }

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <motion.form
      key={`edit-${provider.key}`}
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
            <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('brains.editBrain')}</p>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{provider.key}</h2>
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
        <FormField label="Type">
          <div className="relative">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 pr-8 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            >
              {supportedTypes.map((st) => (
                <option key={st.type} value={st.type}>{st.type}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          </div>
        </FormField>
        <FormField label="Description" colSpan={2}>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('brains.descriptionPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Model *">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('brains.modelPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="Memory Window">
          <input
            type="number"
            min={1}
            value={memoryWindow}
            onChange={(e) => setMemoryWindow(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="Thinking">
          <div className="relative">
            <select
              value={thinking}
              onChange={(e) => setThinking(e.target.value as ThinkingLevel)}
              className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 pr-8 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            >
              <option value="none">none</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          </div>
        </FormField>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-text-primary)]">Settings</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {allSettingKeys.map((key) => {
            const sensitive = isSensitiveKey(key)
            const revealed = revealedKeys.has(key)
            const isRequired = currentTypeInfo?.required_settings.includes(key)

            return (
              <FormField
                key={key}
                label={
                  <>
                    {key}
                    {isRequired ? <span className="ml-1 text-[var(--color-accent)]">*</span> : null}
                  </>
                }
              >
                <div className="relative">
                  <input
                    type={sensitive && !revealed ? 'password' : 'text'}
                    value={settings[key] ?? ''}
                    onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={isRequired ? t('brains.required') : t('brains.optional')}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 pr-9 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                  {sensitive ? (
                    <button
                      type="button"
                      onClick={() => toggleReveal(key)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
                    >
                      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
              </FormField>
            )
          })}
        </div>
      </div>
    </motion.form>
  )
}

// ── Add Modal ───────────────────────────────────────────────────────────────────

function AddBrainModal({
  open,
  supportedTypes,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  supportedTypes: SupportedProviderType[]
  saving: boolean
  onClose: () => void
  onSubmit: (data: ProviderFormData) => Promise<void>
}) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [type, setType] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('')
  const [memoryWindow, setMemoryWindow] = useState('100')
  const [thinking, setThinking] = useState<ThinkingLevel>('none')
  const [emoji, setEmoji] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open && supportedTypes.length > 0 && !type) {
      setType(supportedTypes[0].type)
    }
  }, [open, supportedTypes, type])

  useEffect(() => {
    if (!open) {
      setKey('')
      setType(supportedTypes.length > 0 ? supportedTypes[0].type : '')
      setDescription('')
      setModel('')
      setMemoryWindow('100')
      setThinking('none')
      setEmoji('')
      setSettings({})
      setRevealedKeys(new Set())
    }
  }, [open, supportedTypes])

  const currentTypeInfo = useMemo(
    () => supportedTypes.find((t) => t.type === type) ?? null,
    [type, supportedTypes],
  )

  const allSettingKeys = useMemo(() => {
    if (!currentTypeInfo) return []
    return [...currentTypeInfo.required_settings, ...currentTypeInfo.optional_settings]
  }, [currentTypeInfo])

  const toggleReveal = (settingKey: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(settingKey)) next.delete(settingKey)
      else next.add(settingKey)
      return next
    })
  }

  const canSubmit = key.trim() && type

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const filteredSettings: Record<string, string> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (v.trim()) filteredSettings[k] = v.trim()
    }
    const mw = parseInt(memoryWindow, 10)
    await onSubmit({
      key: key.trim(),
      type,
      description: description.trim(),
      settings: filteredSettings,
      model: model.trim(),
      memory_window: isNaN(mw) ? 100 : mw,
      thinking,
      emoji,
    })
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="add-overlay"
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
                <p className="text-[11px] tracking-[0.06em] tertiary-text">New Brain</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('brains.addBrainTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('brains.addBrainDesc')}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <EmojiPicker value={emoji} onChange={setEmoji} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Key *">
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={t('brains.keyPlaceholder')}
                    autoFocus
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Type *">
                  <div className="relative">
                    <select
                      value={type}
                      onChange={(e) => {
                        setType(e.target.value)
                        setSettings({})
                      }}
                      className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    >
                      {supportedTypes.map((st) => (
                        <option key={st.type} value={st.type}>{st.type} — {st.description}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  </div>
                </FormField>
              </div>

              <FormField label="Description">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('brains.descriptionPlaceholder')}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>

              <div>
                <h4 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">{t('brains.modelSettings')}</h4>
                <div className="grid gap-3 lg:grid-cols-3">
                  <FormField label="Model *">
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={t('brains.modelPlaceholder')}
                      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    />
                  </FormField>
                  <FormField label="Memory Window">
                    <input
                      type="number"
                      min={1}
                      value={memoryWindow}
                      onChange={(e) => setMemoryWindow(e.target.value)}
                      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    />
                  </FormField>
                  <FormField label="Thinking">
                    <div className="relative">
                      <select
                        value={thinking}
                        onChange={(e) => setThinking(e.target.value as ThinkingLevel)}
                        className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                      >
                        <option value="none">none</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    </div>
                  </FormField>
                </div>
              </div>

              {allSettingKeys.length > 0 ? (
                <div>
                  <h4 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</h4>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {allSettingKeys.map((settingKey) => {
                      const sensitive = isSensitiveKey(settingKey)
                      const revealed = revealedKeys.has(settingKey)
                      const isRequired = currentTypeInfo?.required_settings.includes(settingKey)

                      return (
                        <FormField
                          key={settingKey}
                          label={
                            <>
                              {settingKey}
                              {isRequired ? <span className="ml-1 text-[var(--color-accent)]">*</span> : null}
                            </>
                          }
                        >
                          <div className="relative">
                            <input
                              type={sensitive && !revealed ? 'password' : 'text'}
                              value={settings[settingKey] ?? ''}
                              onChange={(e) => setSettings((prev) => ({ ...prev, [settingKey]: e.target.value }))}
                              placeholder={isRequired ? t('brains.required') : t('brains.optional')}
                              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                            />
                            {sensitive ? (
                              <button
                                type="button"
                                onClick={() => toggleReveal(settingKey)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            ) : null}
                          </div>
                        </FormField>
                      )
                    })}
                  </div>
                </div>
              ) : null}

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
                  {t('common.add')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ── Confirm Delete Modal ────────────────────────────────────────────────────────

function ConfirmDeleteModal({
  providerKey,
  provider,
  isBusy,
  onCancel,
  onConfirm,
}: {
  providerKey: string | null
  provider: ProviderInstance | null
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!providerKey || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [providerKey, isBusy, onCancel])

  const hasAgents = provider && provider.used_by_agents.length > 0

  return (
    <AnimatePresence>
      {providerKey ? (
        <motion.div
          key="delete-overlay"
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
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Brain</p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('brains.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('brains.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Brain Key</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{providerKey}</p>
              {provider ? (
                <>
                  <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Type</p>
                  <p className="mt-1 text-sm subtle-text">{provider.type}</p>
                </>
              ) : null}
            </div>

            {hasAgents ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('brains.usedByAgentsWarning')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {provider!.used_by_agents.map((a) => (
                    <span key={a} className="rounded-full border border-[color:var(--color-warning)]/30 px-2.5 py-1 text-[11px] text-[var(--color-warning)]">
                      {a}
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
              <button
                type="button"
                onClick={() => { void onConfirm() }}
                disabled={isBusy}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                  {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {t('common.delete')} Brain
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ── Emoji Picker ────────────────────────────────────────────────────────────────

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
        <span className="text-xl leading-none">{value || '\u{1F9E0}'}</span>
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
  colSpan,
}: {
  label: React.ReactNode
  children: React.ReactNode
  colSpan?: number
}) {
  return (
    <label className={cn('block space-y-1.5', colSpan === 2 && 'col-span-2')}>
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
