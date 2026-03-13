import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  BrainCircuit,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Sun,
  Timer,
  X,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson, AUTH_STORAGE_KEY } from '@/lib/api'
import { ThemedSelect } from '@/components/themed-select'
import { useTheme, type ThemePreference } from '@/features/theme/use-theme'
import { useLocale } from '@/features/locale/use-locale'

type HeartbeatConfig = {
  interval_s: number
  enabled: boolean
}

type RuntimeLimitsConfig = {
  agent_loop_max_iterations: number
  group_max_turns: number
}

type AgentOption = {
  key: string
  name: string
}

type ProviderOption = {
  key: string
  description: string
  model: string
}

async function fetchHeartbeatConfig(agentName: string) {
  return fetchJson<HeartbeatConfig>(`/heartbeat/config?agent_name=${encodeURIComponent(agentName)}`)
}

async function fetchAgentOptions() {
  const res = await fetchJson<{ agents: { key: string; name: string }[] }>('/agents')
  return res.agents.map((a) => ({ key: a.key, name: a.name }))
}

async function fetchProviderOptions() {
  const res = await fetchJson<{ providers: { key: string; description: string; model: string }[] }>('/providers/config')
  return res.providers.map((provider) => ({
    key: provider.key,
    description: provider.description,
    model: provider.model,
  }))
}

async function fetchLeaderProvider() {
  const res = await fetchJson<{ config: { leader_agent?: { provider?: string } } }>('/get-config')
  return res.config?.leader_agent?.provider ?? ''
}

async function fetchRuntimeLimits() {
  const res = await fetchJson<{ config: { runtime?: Partial<RuntimeLimitsConfig> } }>('/get-config')
  return {
    agent_loop_max_iterations: res.config?.runtime?.agent_loop_max_iterations ?? 40,
    group_max_turns: res.config?.runtime?.group_max_turns ?? 12,
  }
}

async function updateHeartbeat(agentName: string, data: { interval_s?: number; enabled?: boolean }) {
  return fetchJson<{ message: string }>(`/heartbeat/config?agent_name=${encodeURIComponent(agentName)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function updateLeaderProvider(providerKey: string) {
  return fetchJson<{ message: string }>('/set-config', {
    method: 'POST',
    body: JSON.stringify({ path: 'leader_agent.provider', value: providerKey }),
  })
}

async function changePassword(newPassword: string) {
  return fetchJson<{ message: string }>('/set-config', {
    method: 'POST',
    body: JSON.stringify({ path: 'auth.password', value: newPassword }),
  })
}

async function updateRuntimeLimits(data: RuntimeLimitsConfig) {
  await Promise.all([
    fetchJson<{ message: string }>('/set-config', {
      method: 'POST',
      body: JSON.stringify({ path: 'runtime.agent_loop_max_iterations', value: data.agent_loop_max_iterations }),
    }),
    fetchJson<{ message: string }>('/set-config', {
      method: 'POST',
      body: JSON.stringify({ path: 'runtime.group_max_turns', value: data.group_max_turns }),
    }),
  ])
}

function useSettingsController() {
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig | null>(null)
  const [runtimeLimits, setRuntimeLimits] = useState<RuntimeLimitsConfig | null>(null)
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [selectedHeartbeatAgent, setSelectedHeartbeatAgent] = useState('')
  const [leaderProvider, setLeaderProvider] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const reload = useCallback(async (preferredAgent?: string) => {
    try {
      const [ag, providerOptions, nextLeaderProvider] = await Promise.all([
        fetchAgentOptions(),
        fetchProviderOptions(),
        fetchLeaderProvider(),
      ])
      const nextRuntimeLimits = await fetchRuntimeLimits()
      const nextAgent =
        preferredAgent
        || ag.find((agent) => agent.key === 'main')?.key
        || ag[0]?.key
        || ''
      setAgents(ag)
      setProviders(providerOptions)
      setLeaderProvider(nextLeaderProvider)
      setRuntimeLimits(nextRuntimeLimits)
      setSelectedHeartbeatAgent(nextAgent)
      if (nextAgent) {
        const hb = await fetchHeartbeatConfig(nextAgent)
        setHeartbeat(hb)
      } else {
        setHeartbeat(null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载设置失败'
      setError(msg)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function init() {
      setLoading(true)
      await reload()
      if (active) setLoading(false)
    }
    void init()
    return () => { active = false }
  }, [reload])

  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg)
    setTimeout(() => setSuccessMessage(null), 2500)
  }, [])

  const handleSelectHeartbeatAgent = useCallback(async (agentName: string) => {
    setSelectedHeartbeatAgent(agentName)
    setError(null)
    try {
      const hb = await fetchHeartbeatConfig(agentName)
      setHeartbeat(hb)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载设置失败'
      setError(msg)
    }
  }, [])

  const handleUpdateHeartbeat = useCallback(async (data: { interval_s?: number; enabled?: boolean }, tFn: (k: string) => string) => {
    if (!selectedHeartbeatAgent) return
    setSavingSection('heartbeat')
    setError(null)
    try {
      await updateHeartbeat(selectedHeartbeatAgent, data)
      await reload(selectedHeartbeatAgent)
      showSuccess(tFn('settings.heartbeatSaved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [reload, selectedHeartbeatAgent, showSuccess])

  const handleChangePassword = useCallback(async (newPassword: string, tFn: (k: string) => string) => {
    setSavingSection('password')
    setError(null)
    try {
      await changePassword(newPassword)
      localStorage.setItem(AUTH_STORAGE_KEY, newPassword)
      showSuccess(tFn('settings.passwordChanged'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [showSuccess])

  const handleUpdateLeaderProvider = useCallback(async (providerKey: string, tFn: (k: string) => string) => {
    setSavingSection('leader')
    setError(null)
    try {
      await updateLeaderProvider(providerKey)
      await reload(selectedHeartbeatAgent || undefined)
      showSuccess(tFn('settings.leaderProviderSaved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [reload, selectedHeartbeatAgent, showSuccess])

  const handleUpdateRuntimeLimits = useCallback(async (data: RuntimeLimitsConfig, tFn: (k: string) => string) => {
    setSavingSection('runtime')
    setError(null)
    try {
      await updateRuntimeLimits(data)
      await reload(selectedHeartbeatAgent || undefined)
      showSuccess(tFn('settings.runtimeSaved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [reload, selectedHeartbeatAgent, showSuccess])

  return {
    heartbeat,
    runtimeLimits,
    agents,
    providers,
    leaderProvider,
    selectedHeartbeatAgent,
    loading,
    error,
    savingSection,
    successMessage,
    setError,
    handleSelectHeartbeatAgent,
    handleUpdateHeartbeat,
    handleChangePassword,
    handleUpdateLeaderProvider,
    handleUpdateRuntimeLimits,
  }
}

export function SettingsPage() {
  const { t } = useTranslation()
  const {
    heartbeat,
    runtimeLimits,
    agents,
    providers,
    leaderProvider,
    selectedHeartbeatAgent,
    loading,
    error,
    savingSection,
    successMessage,
    setError,
    handleSelectHeartbeatAgent,
    handleUpdateHeartbeat,
    handleChangePassword,
    handleUpdateLeaderProvider,
    handleUpdateRuntimeLimits,
  } = useSettingsController()

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
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

      {successMessage ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="panel-surface border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-5 py-3 text-[13px] font-medium text-[var(--color-success)]"
        >
          {successMessage}
        </motion.div>
      ) : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <LoaderCircle className="h-6 w-6 animate-spin text-[var(--color-accent)]" />
            <p className="text-[13px] subtle-text">{t('settings.loading')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AppearanceCard />
          <LeaderProviderCard
            providers={providers}
            value={leaderProvider}
            saving={savingSection === 'leader'}
            onSave={(providerKey) => handleUpdateLeaderProvider(providerKey, t)}
          />
          <RuntimeLimitsCard
            config={runtimeLimits}
            saving={savingSection === 'runtime'}
            onSave={(data) => handleUpdateRuntimeLimits(data, t)}
          />
          <HeartbeatCard
            config={heartbeat}
            agents={agents}
            selectedAgent={selectedHeartbeatAgent}
            onSelectAgent={handleSelectHeartbeatAgent}
            saving={savingSection === 'heartbeat'}
            onSave={(data) => handleUpdateHeartbeat(data, t)}
          />
          <PasswordCard
            saving={savingSection === 'password'}
            onSave={(pw) => handleChangePassword(pw, t)}
          />
        </div>
      )}
    </section>
  )
}

function RuntimeLimitsCard({
  config,
  saving,
  onSave,
}: {
  config: RuntimeLimitsConfig | null
  saving: boolean
  onSave: (data: RuntimeLimitsConfig) => Promise<void>
}) {
  const { t } = useTranslation()
  const [agentLoopIterations, setAgentLoopIterations] = useState('')
  const [groupMaxTurns, setGroupMaxTurns] = useState('')

  useEffect(() => {
    if (!config) {
      return
    }
    setAgentLoopIterations(String(config.agent_loop_max_iterations))
    setGroupMaxTurns(String(config.group_max_turns))
  }, [config])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) {
      return
    }
    const nextAgentLoopIterations = parseInt(agentLoopIterations, 10)
    const nextGroupMaxTurns = parseInt(groupMaxTurns, 10)
    if (!Number.isFinite(nextAgentLoopIterations) || nextAgentLoopIterations <= 0) {
      return
    }
    if (!Number.isFinite(nextGroupMaxTurns) || nextGroupMaxTurns <= 0) {
      return
    }
    if (
      nextAgentLoopIterations === config.agent_loop_max_iterations
      && nextGroupMaxTurns === config.group_max_turns
    ) {
      return
    }
    await onSave({
      agent_loop_max_iterations: nextAgentLoopIterations,
      group_max_turns: nextGroupMaxTurns,
    })
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <BrainCircuit className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.runtimeTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.runtimeDesc')}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label={t('settings.agentLoopIterationsLabel')}>
          <input
            type="number"
            min={1}
            value={agentLoopIterations}
            onChange={(e) => setAgentLoopIterations(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label={t('settings.groupMaxTurnsLabel')}>
          <input
            type="number"
            min={1}
            value={groupMaxTurns}
            onChange={(e) => setGroupMaxTurns(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <div className="flex justify-end">
        <SaveButton saving={saving} />
      </div>
    </motion.form>
  )
}

function LeaderProviderCard({
  providers,
  value,
  saving,
  onSave,
}: {
  providers: ProviderOption[]
  value: string
  saving: boolean
  onSave: (providerKey: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState(value)

  useEffect(() => {
    setSelectedProvider(value)
  }, [value])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProvider || selectedProvider === value) {
      return
    }
    await onSave(selectedProvider)
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <BrainCircuit className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.leaderProviderTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.leaderProviderDesc')}</p>
        </div>
      </div>

      <FormField label={t('settings.leaderProviderLabel')}>
        <ThemedSelect
          value={selectedProvider}
          options={providers.map((provider) => ({
            value: provider.key,
            label: provider.model ? `${provider.key} (${provider.model})` : provider.key,
          }))}
          onChange={setSelectedProvider}
          buttonClassName="px-4 py-2 text-[13px]"
          placeholder={t('settings.leaderProviderPlaceholder')}
        />
      </FormField>

      <div className="flex justify-end">
        <SaveButton saving={saving} />
      </div>
    </motion.form>
  )
}

function AppearanceCard() {
  const { t } = useTranslation()
  const { preference, setPreference } = useTheme()
  const { locale, setLocale } = useLocale()

  const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('settings.themeLight'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), icon: Moon },
    { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0 }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <Palette className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.appearanceTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.appearanceDesc')}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label={t('settings.language')}>
          <div className="flex gap-2">
            {(['en', 'zh'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLocale(lang)}
                className={
                  locale === lang
                    ? 'flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition'
                    : 'flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]'
                }
              >
                {lang === 'en' ? 'English' : '中文'}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label={t('settings.theme')}>
          <div className="flex gap-2">
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreference(value)}
                className={
                  preference === value
                    ? 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition'
                    : 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]'
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </FormField>
      </div>
    </motion.div>
  )
}

function HeartbeatCard({
  config,
  agents,
  selectedAgent,
  onSelectAgent,
  saving,
  onSave,
}: {
  config: HeartbeatConfig | null
  agents: AgentOption[]
  selectedAgent: string
  onSelectAgent: (agentName: string) => void
  saving: boolean
  onSave: (data: { interval_s?: number; enabled?: boolean }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [intervalS, setIntervalS] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (config) {
      setIntervalS(String(config.interval_s))
      setEnabled(config.enabled)
    }
  }, [config])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) return
    const payload: { interval_s?: number; enabled?: boolean } = {}
    const iv = parseInt(intervalS, 10)
    if (!isNaN(iv) && iv !== config.interval_s) payload.interval_s = iv
    if (enabled !== config.enabled) payload.enabled = enabled
    if (Object.keys(payload).length === 0) return
    await onSave(payload)
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <Timer className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.heartbeatTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.heartbeatDesc')}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Agent">
          <AgentSelect value={selectedAgent} agents={agents} onChange={onSelectAgent} />
        </FormField>
        <FormField label={t('settings.intervalLabel')}>
          <input
            type="number"
            min={1}
            value={intervalS}
            onChange={(e) => setIntervalS(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <div className="flex items-center justify-between gap-4">
        <EnableToggle enabled={enabled} onChange={setEnabled} />
        <SaveButton saving={saving} />
      </div>
    </motion.form>
  )
}

function PasswordCard({
  saving,
  onSave,
}: {
  saving: boolean
  onSave: (newPassword: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    if (!newPassword.trim()) {
      setLocalError(t('settings.passwordEmpty'))
      return
    }
    if (newPassword !== confirmPassword) {
      setLocalError(t('settings.passwordMismatch'))
      return
    }
    await onSave(newPassword)
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.12 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <KeyRound className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.passwordTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.passwordDesc')}</p>
        </div>
      </div>

      {localError ? (
        <p className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {localError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label={t('settings.newPassword')}>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('settings.newPasswordPlaceholder')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
            >
              {showNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </FormField>
        <FormField label={t('settings.confirmPassword')}>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('settings.confirmPasswordPlaceholder')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
            >
              {showConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </FormField>
      </div>

      <div className="flex justify-end">
        <SaveButton saving={saving} label={t('settings.changePassword')} />
      </div>
    </motion.form>
  )
}

function AgentSelect({
  value,
  agents,
  onChange,
}: {
  value: string
  agents: AgentOption[]
  onChange: (v: string) => void
}) {
  return (
    <ThemedSelect
      value={value}
      options={agents.map((a) => ({ value: a.key, label: `${a.key} (${a.name})` }))}
      onChange={onChange}
      buttonClassName="px-4 py-2 text-[13px]"
    />
  )
}

function EnableToggle({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] px-3 py-1.5 text-[12px] transition hover:border-[var(--color-border-strong)]"
    >
      <span
        className={
          enabled
            ? 'h-2 w-2 rounded-full bg-[var(--color-success)]'
            : 'h-2 w-2 rounded-full bg-[var(--color-border-subtle)]'
        }
      />
      <span className={enabled ? 'text-[var(--color-text-primary)]' : 'tertiary-text'}>
        {enabled ? t('common.enabled') : t('common.disabled')}
      </span>
    </button>
  )
}

function SaveButton({ saving, label }: { saving: boolean; label?: string }) {
  const { t } = useTranslation()
  const displayLabel = label ?? t('common.save')
  return (
    <button
      type="submit"
      disabled={saving}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
      {displayLabel}
    </button>
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
