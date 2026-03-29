// Friday Code Theme — Pure Ink color values (no chalk for Ink components)
export const colors = {
  brand: '#7C3AED',
  brandLight: '#A78BFA',
  cyan: '#06B6D4',
  amber: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  blue: '#3B82F6',
  text: '#E5E7EB',
  textSecondary: '#9CA3AF',
  dim: '#6B7280',
  dimmer: '#4B5563',
  bg: '#1E1B2E',
} as const;

export const icons = {
  friday: '◆',
  user: '▶',
  thinking: '○',
  tool: '⚙',
  ok: '✓',
  fail: '✗',
  warn: '⚠',
  info: 'ℹ',
  arrow: '→',
  dot: '·',
  pipe: '│',
  prompt: '❯',
  loading: '◌',
} as const;

export const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show commands' },
  { cmd: '/model', desc: 'Select AI model' },
  { cmd: '/provider', desc: 'Manage providers & API keys' },
  { cmd: '/scope', desc: 'Change working directory' },
  { cmd: '/clear', desc: 'Clear conversation' },
  { cmd: '/new', desc: 'New conversation' },
  { cmd: '/history', desc: 'Show message count' },
  { cmd: '/exit', desc: 'Exit Friday Code' },
] as const;
