/**
 * MCP Service Types. The MCP servers themselves run inside DeepSeek Harness;
 * the app only reads and writes the shared config file.
 */

import type { MCPServers } from '@/hooks/useMCPServers'

export interface MCPService {
  getMCPConfig(): Promise<{ mcpServers: MCPServers }>
  updateMCPConfig(configs: string): Promise<void>
}
