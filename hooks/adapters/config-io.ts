import type { Io } from '../runtime/io.ts'

import type { ProjectConfig } from '../domain/config.ts'
import { parseProjectConfig } from '../domain/config.ts'

export const PROJECT_CONFIG_PATH = '.zboard/config.json'

export async function readProjectConfig(io: Io): Promise<ProjectConfig> {
  const text = await io.fs.read(PROJECT_CONFIG_PATH).catch(() => undefined)
  return parseProjectConfig(typeof text === 'string' ? text : undefined)
}
