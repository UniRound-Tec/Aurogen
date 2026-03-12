import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  LoaderCircle,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Shield,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { fetchJson } from '@/lib/api'
import { ThemedSelect } from '@/components/themed-select'
import { cn } from '@/lib/utils'

type ChannelEntry = {
  key: string
  type: string
  agent_name: string
  description: string
  settings: Record<string, string>
  builtin: boolean
  running: boolean
  emoji: string
}

type SupportedType = {
  type: string
  description: string
  required_settings: string[]
}

type AgentOption = {
  key: string
  name: string
}

type AddChannelFormData = {
  key: string
  type: string
  agent_name: string
  description: string
  settings: Record<string, string>
  emoji: string
}

const EMOJI_PALETTE = [
  '🧠', '🤖', '⚡', '✨', '🚀', '🔥', '💡', '🌈', '🌍', '🎯',
  '🔮', '💫', '🧊', '💎', '🌟', '🐍', '🐻', '🦅', '🦙', '👾',
  '🎨', '🔒', '🛠️', '💬', '👥', '🐾', '🐱', '🦁', '🐺', '🦊',
  '🐸', '🦋', '🐝', '🦄', '🐳', '🐙', '🦑', '🦖', '🐲', '🦜',
  '😎', '🥳', '🤩', '😈', '👻', '💀', '🎃', '🤠', '🥷', '🧙',
  '🌸', '🍀', '🌵', '🍄', '🌙', '☀️', '🌊', '❄️', '🔔', '🎵',
  '🎮', '🕹️', '📱', '💻', '🖥️', '⌨️', '🧲', '🔬', '🧪', '💊',
]

function getDisplayEmoji(channel: ChannelEntry): string {
  return channel.emoji || '💬'
}

async function fetchChannelsConfig() {
  return fetchJson<{ channels: ChannelEntry[] }>('/channels/config')
}

async function fetchSupportedChannels() {
  return fetchJson<{ supported: SupportedType[] }>('/channels/supported')
}

async function fetchAgentOptions() {
  const res = await fetchJson<{ agents: { key: string; name: string }[] }>('/agents')
  return res.agents.map((a) => ({ key: a.key, name: a.name }))
}

async function addChannel(data: AddChannelFormData) {
  return fetchJson<{ message: string }>('/channels', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function updateChannel(
  key: string,
  data: { agent_name?: string; description?: string; settings?: Record<string, string>; emoji?: string },
) {
  return fetchJson<{ message: string }>(`/channels/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function deleteChannel(key: string) {
  return fetchJson<{ message: string }>(`/channels/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

async function reloadChannels() {
  return fetchJson<{ started: string[]; stopped: string[] }>('/channels/reload', {
    method: 'POST',
  })
}

function useChannelsController() {
  const [channels, setChannels] = useState<ChannelEntry[]>([])
  const [supportedTypes, setSupportedTypes] = useState<SupportedType[]>([])
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reloading, setReloading] = useState(false)

  const selectedChannel = useMemo(
    () => channels.find((c) => c.key === selectedKey) ?? null,
    [channels, selectedKey],
  )

  const reload = useCallback(async () => {
    try {
      const [channelsRes, agents] = await Promise.all([
        fetchChannelsConfig(),
        fetchAgentOptions(),
      ])
      setChannels(channelsRes.channels)
      setAgentOptions(agents)
      // supported types 加载失败不阻断主流程
      fetchSupportedChannels()
        .then((res) => setSupportedTypes(res.supported))
        .catch(() => {})
      return channelsRes.channels
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载 channels 失败'
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
    return () => {
      active = false
    }
  }, [reload])

  const handleAdd = useCallback(
    async (data: AddChannelFormData) => {
      setSaving(true)
      setError(null)
      try {
        await addChannel(data)
        const list = await reload()
        setSelectedKey(data.key)
        return list
      } catch (err) {
        const msg = err instanceof Error ? err.message : '添加 channel 失败'
        setError(msg)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [reload],
  )

  const handleUpdate = useCallback(
    async (
      key: string,
      data: { agent_name?: string; description?: string; settings?: Record<string, string>; emoji?: string },
    ) => {
      setSaving(true)
      setError(null)
      try {
        await updateChannel(key, data)
        await reload()
      } catch (err) {
        const msg = err instanceof Error ? err.message : '更新 channel 失败'
        setError(msg)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [reload],
  )

  const handleDelete = useCallback(
    async (key: string) => {
      setDeleting(true)
      setError(null)
      try {
        await deleteChannel(key)
        const list = await reload()
        if (selectedKey === key) {
          setSelectedKey(list.length > 0 ? list[0].key : null)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '删除 channel 失败'
        setError(msg)
        throw err
      } finally {
        setDeleting(false)
      }
    },
    [reload, selectedKey],
  )

  const handleReload = useCallback(async () => {
    setReloading(true)
    setError(null)
    try {
      await reloadChannels()
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reload 失败'
      setError(msg)
    } finally {
      setReloading(false)
    }
  }, [reload])

  return {
    channels,
    supportedTypes,
    agentOptions,
    selectedKey,
    selectedChannel,
    loading,
    error,
    saving,
    deleting,
    reloading,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
    handleReload,
  }
}

export function ChannelsPage() {
  const { t } = useTranslation()
  const {
    channels,
    supportedTypes,
    agentOptions,
    selectedKey,
    selectedChannel,
    loading,
    error,
    saving,
    deleting,
    reloading,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
    handleReload,
  } = useChannelsController()

  const [searchValue, setSearchValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const filteredChannels = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return channels
    return channels.filter(
      (c) =>
        c.key.toLowerCase().includes(kw) ||
        c.type.toLowerCase().includes(kw) ||
        c.agent_name.toLowerCase().includes(kw),
    )
  }, [searchValue, channels])

  const drawerOpen = selectedKey !== null

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
            placeholder={t('channels.search')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </div>
        <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
          {channels.length} total
        </div>
        <button
          type="button"
          onClick={() => { void handleReload() }}
          disabled={reloading}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'animate-spin')} />
          Reload
        </button>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-4 py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)]"
        >
          <Plus className="h-4 w-4" />
          Add Channel
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="scroll-area h-full overflow-y-auto p-1">
          {loading ? (
            <CardGridSkeleton />
          ) : filteredChannels.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {filteredChannels.map((channel, index) => {
                  const selected = selectedKey === channel.key
                  return (
                    <motion.button
                      key={channel.key}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      onClick={() => {
                        setSelectedKey(channel.key)
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
                          {getDisplayEmoji(channel)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium',
                              channel.running
                                ? 'bg-[color:var(--color-success)]/15 text-[var(--color-success)]'
                                : 'bg-[var(--color-bg-active)] text-[var(--color-text-tertiary)]',
                            )}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                channel.running ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border-subtle)]',
                              )}
                            />
                            {channel.running ? 'online' : 'offline'}
                          </span>
                          {channel.builtin ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                              <Shield className="h-2.5 w-2.5" />
                              builtin
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                        {channel.key}
                      </p>
                      <p className="mt-1 truncate text-[11px] tertiary-text">
                        {channel.type} · {channel.agent_name}
                      </p>
                      {channel.description ? (
                        <p className="mt-2 line-clamp-2 text-[11px] subtle-text">
                          {channel.description}
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
                {channels.length === 0
                  ? t('channels.emptyNoConfig')
                  : t('channels.emptyNoMatch')}
              </div>
            </div>
          )}
        </div>

        <ChannelDrawer
          open={drawerOpen}
          channel={selectedChannel}
          agentOptions={agentOptions}
          editMode={editMode}
          saving={saving}
          onClose={closeDrawer}
          onEdit={() => setEditMode(true)}
          onCancelEdit={() => setEditMode(false)}
          onSave={async (data) => {
            if (!selectedChannel) return
            await handleUpdate(selectedChannel.key, data)
            setEditMode(false)
          }}
          onDelete={() => {
            if (selectedChannel) setPendingDeleteKey(selectedChannel.key)
          }}
        />
      </div>

      <AddChannelModal
        open={showAddModal}
        supportedTypes={supportedTypes}
        agentOptions={agentOptions}
        saving={saving}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (data) => {
          await handleAdd(data)
          setShowAddModal(false)
        }}
      />

      <ConfirmDeleteModal
        channelKey={pendingDeleteKey}
        channel={pendingDeleteKey ? (channels.find((c) => c.key === pendingDeleteKey) ?? null) : null}
        isBusy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDeleteKey(null)
        }}
        onConfirm={async () => {
          if (!pendingDeleteKey) return
          try {
            await handleDelete(pendingDeleteKey)
            setPendingDeleteKey(null)
          } catch {
            /* error already set in controller */
          }
        }}
      />
    </section>
  )
}

function WhatsAppQrSection({ channelKey }: { channelKey: string }) {
  const [qr, setQr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchQr = useCallback(async () => {
    try {
      const res = await fetchJson<{ qr: string | null }>(`/channels/${encodeURIComponent(channelKey)}/qr`)
      setQr(res.qr)
      return res.qr
    } catch {
      setQr(null)
      return null
    }
  }, [channelKey])

  const startPolling = useCallback(async () => {
    setLoading(true)
    const result = await fetchQr()
    setLoading(false)
    setPolling(true)
    if (result) return
    intervalRef.current = setInterval(() => { void fetchQr() }, 3000)
  }, [fetchQr])

  useEffect(() => {
    if (polling && qr && intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [polling, qr])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  if (!polling) {
    return (
      <button
        type="button"
        onClick={() => { void startPolling() }}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
      >
        {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
        Show QR Code
      </button>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 p-5">
      {qr ? (
        <>
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={qr} size={200} />
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Open WhatsApp → Linked Devices → Scan
          </p>
        </>
      ) : (
        <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--color-text-tertiary)]">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Waiting for QR code...
        </div>
      )}
    </div>
  )
}

function ChannelDetail({
  channel,
  onEdit,
  onDelete,
}: {
  channel: ChannelEntry
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const settingsEntries = Object.entries(channel.settings)
  const isWhatsApp = channel.type === 'whatsapp'

  return (
    <motion.div
      key={channel.key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mb-5 flex items-center justify-end gap-2">
        {isWhatsApp && !channel.running ? (
          <WhatsAppQrSection channelKey={channel.key} />
        ) : null}
        <button
          type="button"
          onClick={onEdit}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
        >
          {t('common.edit')}
        </button>
        {!channel.builtin ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20"
          >
            {t('common.delete')}
          </button>
        ) : null}
      </div>

      {isWhatsApp && channel.running ? (
        <div className="mb-4">
          <WhatsAppQrSection channelKey={channel.key} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailField label="Key" value={channel.key} />
        <DetailField label="Type" value={channel.type} />
        <DetailField label="Agent" value={channel.agent_name || '—'} />
        <DetailField label="Description" value={channel.description || '—'} />
      </div>

      {settingsEntries.length > 0 ? (
        <>
          <div className="my-5 h-px bg-[var(--color-bg-active)]" />
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {settingsEntries.map(([k, v]) => (
              <DetailField key={k} label={k} value={String(v)} />
            ))}
          </div>
        </>
      ) : null}
    </motion.div>
  )
}

function ChannelEditor({
  channel,
  agentOptions,
  saving,
  onSave,
  onCancel,
}: {
  channel: ChannelEntry
  agentOptions: AgentOption[]
  saving: boolean
  onSave: (data: {
    agent_name?: string
    description?: string
    settings?: Record<string, string>
    emoji?: string
  }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [agentName, setAgentName] = useState(channel.agent_name)
  const [description, setDescription] = useState(channel.description)
  const [emoji, setEmoji] = useState(channel.emoji || '')
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(channel.settings).map(([k, v]) => [k, String(v)])),
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: { agent_name?: string; description?: string; settings?: Record<string, string>; emoji?: string } = {}
    if (agentName !== channel.agent_name) payload.agent_name = agentName
    if (description !== channel.description) payload.description = description
    if (emoji !== (channel.emoji || '')) payload.emoji = emoji

    const settingsChanged = Object.keys(settingsValues).some(
      (k) => settingsValues[k] !== String(channel.settings[k] ?? ''),
    )
    if (settingsChanged) payload.settings = settingsValues

    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }
    await onSave(payload)
  }

  const settingsKeys = Object.keys(channel.settings)

  return (
    <motion.form
      key={`edit-${channel.key}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <div>
            <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('channels.editChannel')}</p>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{channel.key}</h2>
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

      <div className="grid gap-3 lg:grid-cols-2">
        <FormField label="Agent *">
          <ThemedSelect
            value={agentName}
            options={agentOptions.map((a) => ({ value: a.key, label: `${a.key} (${a.name})` }))}
            onChange={setAgentName}
            buttonClassName="px-3 py-1.5 text-[13px]"
          />
        </FormField>
        <FormField label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('channels.descriptionPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      {settingsKeys.length > 0 ? (
        <>
          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-text-primary)]">Settings</h3>
            <div className="grid gap-2.5 lg:grid-cols-2">
            {settingsKeys.map((k) => (
              <FormField key={k} label={k}>
                <input
                  value={settingsValues[k] ?? ''}
                  onChange={(e) => setSettingsValues((prev) => ({ ...prev, [k]: e.target.value }))}
                  placeholder={k}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>
            ))}
            </div>
          </div>
        </>
      ) : null}
    </motion.form>
  )
}

function ChannelDrawer({
  open,
  channel,
  agentOptions,
  editMode,
  saving,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  open: boolean
  channel: ChannelEntry | null
  agentOptions: AgentOption[]
  editMode: boolean
  saving: boolean
  onClose: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (data: { agent_name?: string; description?: string; settings?: Record<string, string>; emoji?: string }) => Promise<void>
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
      {open && channel ? (
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
              <span className="text-xl" role="img">{getDisplayEmoji(channel)}</span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{channel.key}</p>
                  {channel.builtin ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                      <Shield className="h-2.5 w-2.5" />
                      builtin
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      channel.running
                        ? 'bg-[color:var(--color-success)]/15 text-[var(--color-success)]'
                        : 'bg-[var(--color-bg-active)] text-[var(--color-text-tertiary)]',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        channel.running ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border-subtle)]',
                      )}
                    />
                    {channel.running ? 'online' : 'offline'}
                  </span>
                </div>
                <p className="text-[11px] tertiary-text">{channel.type} · {channel.agent_name}</p>
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
              <ChannelEditor
                channel={channel}
                agentOptions={agentOptions}
                saving={saving}
                onSave={onSave}
                onCancel={onCancelEdit}
              />
            ) : (
              <ChannelDetail
                channel={channel}
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

function AddChannelModal({
  open,
  supportedTypes,
  agentOptions,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  supportedTypes: SupportedType[]
  agentOptions: AgentOption[]
  saving: boolean
  onClose: () => void
  onSubmit: (data: AddChannelFormData) => Promise<void>
}) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [type, setType] = useState('')
  const [agentName, setAgentName] = useState('')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState('')
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({})

  const selectedSupportedType = supportedTypes.find((t) => t.type === type) ?? null
  const requiredSettings = selectedSupportedType?.required_settings ?? []

  useEffect(() => {
    if (open && supportedTypes.length > 0 && !type) {
      setType(supportedTypes[0].type)
    }
  }, [open, supportedTypes, type])

  useEffect(() => {
    if (open && agentOptions.length > 0 && !agentName) {
      setAgentName(agentOptions[0].key)
    }
  }, [open, agentOptions, agentName])

  useEffect(() => {
    setSettingsValues(
      Object.fromEntries(requiredSettings.map((k) => [k, settingsValues[k] ?? ''])),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  useEffect(() => {
    if (!open) {
      setKey('')
      setType(supportedTypes.length > 0 ? supportedTypes[0].type : '')
      setAgentName(agentOptions.length > 0 ? agentOptions[0].key : '')
      setDescription('')
      setEmoji('')
      setSettingsValues({})
    }
  }, [open, supportedTypes, agentOptions])

  const allSettingsFilled = requiredSettings.every((k) => (settingsValues[k] ?? '').trim() !== '')
  const canSubmit = key.trim() && type && agentName && allSettingsFilled

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit({
      key: key.trim(),
      type,
      agent_name: agentName,
      description: description.trim(),
      settings: settingsValues,
      emoji,
    })
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="add-channel-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
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
            <form
              onSubmit={(e) => {
                void handleSubmit(e)
              }}
              className="space-y-5"
            >
              <div>
                <p className="text-[11px] tracking-[0.06em] tertiary-text">New Channel</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('channels.addChannelTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('channels.addChannelDesc')}
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
                    placeholder={t('channels.keyPlaceholder')}
                    autoFocus
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Type *">
                  <ThemedSelect
                    value={type}
                    options={supportedTypes.map((t) => ({ value: t.type, label: t.type }))}
                    onChange={setType}
                    buttonClassName="px-4 py-2 text-[13px]"
                  />
                </FormField>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Agent *">
                  <ThemedSelect
                    value={agentName}
                    options={agentOptions.map((a) => ({ value: a.key, label: `${a.key} (${a.name})` }))}
                    onChange={setAgentName}
                    buttonClassName="px-4 py-2 text-[13px]"
                  />
                </FormField>
                <FormField label="Description">
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="描述（可选）"
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
              </div>

              {selectedSupportedType ? (
                <>
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
                    <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('channels.channelDescLabel')}</p>
                    <p className="mt-1 text-[13px] text-[var(--color-text-primary)]">
                      {selectedSupportedType.description}
                    </p>
                  </div>

                  {requiredSettings.length > 0 ? (
                    <>
                      <div className="h-px bg-[var(--color-bg-active)]" />
                      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</p>
                      <div className="grid gap-4 lg:grid-cols-2">
                        {requiredSettings.map((k) => (
                          <FormField key={k} label={`${k} *`}>
                            <input
                              value={settingsValues[k] ?? ''}
                              onChange={(e) =>
                                setSettingsValues((prev) => ({ ...prev, [k]: e.target.value }))
                              }
                              placeholder={k}
                              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                            />
                          </FormField>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
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

function ConfirmDeleteModal({
  channelKey,
  channel,
  isBusy,
  onCancel,
  onConfirm,
}: {
  channelKey: string | null
  channel: ChannelEntry | null
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!channelKey || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [channelKey, isBusy, onCancel])

  const isBuiltin = channel?.builtin ?? false

  return (
    <AnimatePresence>
      {channelKey ? (
        <motion.div
          key="delete-channel-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => {
            if (!isBusy) onCancel()
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Channel</p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('channels.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('channels.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Channel Key</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{channelKey}</p>
              {channel ? (
                <>
                  <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Type</p>
                  <p className="mt-1 text-sm subtle-text">{channel.type}</p>
                </>
              ) : null}
            </div>

            {isBuiltin ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('channels.builtinCannotDelete')}
                </p>
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
                  onClick={() => {
                    void onConfirm()
                  }}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {t('common.delete')} Channel
                </button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

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
        <span className="text-xl leading-none">{value || '💬'}</span>
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

function DetailField({
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
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] p-4"
        >
          <div className="mb-3 h-5 w-14 rounded-full bg-[var(--color-bg-active)]" />
          <div className="h-4 w-24 rounded bg-[var(--color-bg-active)]" />
          <div className="mt-2 h-3 w-36 rounded bg-[var(--color-bg-hover)]/60" />
        </div>
      ))}
    </div>
  )
}
