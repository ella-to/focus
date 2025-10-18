import { nanoid } from 'nanoid'

const WORKSPACE_PREFIX = 'w_'
const BULLET_PREFIX = 'b_'

export const DEFAULT_WORKSPACE_ID = `${WORKSPACE_PREFIX}default`
export const DEFAULT_WORKSPACE_NAME = 'Default'

export function generateWorkspaceId(): string {
  return `${WORKSPACE_PREFIX}${nanoid()}`
}

export function ensureWorkspaceId(id: string): string {
  return id.startsWith(WORKSPACE_PREFIX) ? id : `${WORKSPACE_PREFIX}${id}`
}

export function generateBulletId(): string {
  return `${BULLET_PREFIX}${nanoid()}`
}

export function ensureBulletId(id: string): string {
  return id.startsWith(BULLET_PREFIX) ? id : `${BULLET_PREFIX}${id}`
}
