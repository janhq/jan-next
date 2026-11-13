/**
 * Default MCP Service - Generic implementation with minimal returns
 */

import type { MCPServers } from '@/hooks/useMCPServers'
import type { MCPService } from './types'

export class DefaultMCPService implements MCPService {
  async getMCPConfig(): Promise<{ mcpServers: MCPServers }> {
    return { mcpServers: {} }
  }

  async updateMCPConfig(configs: string): Promise<void> {
    void configs
  }
}
