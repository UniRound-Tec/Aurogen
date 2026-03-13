import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/app/app-shell'
import { AgentGroupsPage } from '@/pages/agent-groups-page'
import { ChatPage } from '@/pages/chat-page'
import { McpPage } from '@/pages/mcp-page'
import {
  AgentsPage,
  ChannelsPage,
  NotFoundPage,
  ProvidersPage,
  StatusPage,
} from '@/pages/resource-pages'
import { CronPage } from '@/pages/cron-page'
import { SettingsPage } from '@/pages/settings-page'
import { SessionsPage } from '@/pages/sessions-page'
import { SkillsPage } from '@/pages/skills-page'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate to="/chat" replace />,
      },
      {
        path: '/chat',
        element: <ChatPage />,
      },
      {
        path: '/groups',
        element: <AgentGroupsPage />,
      },
      {
        path: '/brains',
        element: <ProvidersPage />,
      },
      {
        path: '/claws',
        element: <AgentsPage />,
      },
      {
        path: '/channels',
        element: <ChannelsPage />,
      },
      {
        path: '/skills',
        element: <SkillsPage />,
      },
      {
        path: '/cron',
        element: <CronPage />,
      },
      {
        path: '/mcp',
        element: <McpPage />,
      },
      {
        path: '/sessions',
        element: <SessionsPage />,
      },
      {
        path: '/status',
        element: <StatusPage />,
      },
      {
        path: '/settings',
        element: <SettingsPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
])
