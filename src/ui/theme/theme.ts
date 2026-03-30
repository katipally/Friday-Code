// Friday Code — Monochrome Violet + Gray palette
// One accent family, clean gray scale, desaturated semantics

export const colors = {
  // Primary — soft violet family
  primary: '#A78BFA',
  primaryBright: '#C4B5FD',
  primaryDim: '#7C3AED',

  // Text scale — cool gray
  text: '#E5E7EB',
  secondary: '#9CA3AF',
  muted: '#6B7280',
  subtle: '#4B5563',
  faint: '#374151',

  // Semantic — desaturated
  success: '#6EE7B7',
  warn: '#FCD34D',
  error: '#FCA5A5',
  info: '#93C5FD',

  // Backward-compat aliases (used by ModelSelector, etc.)
  brand: '#A78BFA',
  brandLight: '#C4B5FD',
  accent: '#A78BFA',
  cyan: '#93C5FD',
  amber: '#FCD34D',
  green: '#6EE7B7',
  red: '#FCA5A5',
  blue: '#93C5FD',
  textSecondary: '#9CA3AF',
  dim: '#6B7280',
  dimmer: '#4B5563',
  line: '#374151',
  surface: '#1F2937',
  bg: '#111827',
} as const;

export const icons = {
  friday: '◈',
  user: '●',
  thinking: '◆',
  tool: '◇',
  ok: '✓',
  fail: '✕',
  running: '◎',
  spine: '│',
  dot: '·',
  arrow: '→',
  prompt: '›',
  scope: '⌂',
  step: '◆',
  warn: '!',
  info: 'i',
  detach: '◫',
  timeline: '◎',
  panel: '▣',
  loading: '⠋',
} as const;

export const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'commands & shortcuts' },
  { cmd: '/model', desc: 'switch model' },
  { cmd: '/provider', desc: 'manage providers' },
  { cmd: '/scope', desc: 'change scope' },
  { cmd: '/config', desc: 'view/set config' },
  { cmd: '/clear', desc: 'clear history' },
  { cmd: '/new', desc: 'new conversation' },
  { cmd: '/history', desc: 'message count' },
  { cmd: '/exit', desc: 'quit' },
] as const;
