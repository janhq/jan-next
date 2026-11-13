/**
 * Tauri MCP Service - reads/writes `<data>/mcp_config.json`
 */

import { invoke } from '@tauri-apps/api/core'
import type { MCPServers } from '@/hooks/useMCPServers'
import { DefaultMCPService } from './default'

export class TauriMCPService extends DefaultMCPService {
  async getMCPConfig(): Promise<{ mcpServers: MCPServers }> {
    const raw = await invoke<string>('get_mcp_configs')
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text) return { mcpServers: {} }

    try {
      const parsed = JSON.parse(text)
      const servers = parsed?.mcpServers
      return {
        mcpServers:
          servers && typeof servers === 'object' && !Array.isArray(servers)
            ? (servers as MCPServers)
            : {},
      }
    } catch (error) {
      console.error('Failed to parse MCP config JSON:', error)
      return { mcpServers: {} }
    }
  }

  async updateMCPConfig(configs: string): Promise<void> {
    await invoke('save_mcp_configs', { configs })
  }
}
