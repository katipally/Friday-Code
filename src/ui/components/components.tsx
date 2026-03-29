import React, { useState, useEffect, type FC, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../theme/theme.js';

// ─── Spinner ─────────────────────────────────────────────────────────────────
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const Spinner: FC<{ label?: string; color?: string }> = ({
  label,
  color = colors.cyan,
}) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <Box>
      <Text color={color}>{FRAMES[i]} </Text>
      {label && <Text color={colors.dim}>{label}</Text>}
    </Box>
  );
};

// ─── Panel ───────────────────────────────────────────────────────────────────
export const Panel: FC<{
  title?: string;
  borderColor?: string;
  children: ReactNode;
  width?: number | string;
}> = ({ title, borderColor = colors.dimmer, children, width }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} width={width}>
    {title && (
      <Text bold color={colors.text}>{title}</Text>
    )}
    {children}
  </Box>
);

// ─── StatusBar ───────────────────────────────────────────────────────────────
export const StatusBar: FC<{
  model?: string;
  provider?: string;
  scope?: string;
  tokens?: { prompt: number; completion: number };
  status?: string;
}> = ({ model = 'none', provider = '', scope = '.', tokens, status }) => {
  const left = `${icons.friday} ${provider ? `${provider}/` : ''}${model} | ${scope}`;
  const right = [
    tokens && tokens.prompt > 0 ? `${tokens.prompt}+${tokens.completion}tok` : '',
    status || '',
  ].filter(Boolean).join(' ');

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={colors.brand}>{left}</Text>
      {right ? <Text color={colors.amber}>{right}</Text> : null}
    </Box>
  );
};

// ─── ToolCallBlock ───────────────────────────────────────────────────────────
export const ToolCallBlock: FC<{
  toolName: string;
  args?: unknown;
  result?: unknown;
  isRunning?: boolean;
}> = ({ toolName, args, result, isRunning }) => {
  const argStr = args && typeof args === 'object'
    ? Object.entries(args as Record<string, unknown>)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 50)}"` : v}`)
        .join(' ')
    : '';

  const status = isRunning ? '...' : (result ? ` ${icons.ok}` : '');

  return (
    <Box marginLeft={3} flexDirection="column">
      <Text color={colors.amber}>{icons.tool} {toolName}{status}</Text>
      {argStr && <Text color={colors.dim}>   {argStr}</Text>}
    </Box>
  );
};

// ─── ThinkingBlock ───────────────────────────────────────────────────────────
export const ThinkingBlock: FC<{ text: string; isStreaming?: boolean }> = ({ text, isStreaming }) => {
  const lines = text.split('\n');
  const show = isStreaming ? lines.slice(-6) : lines.slice(0, 3);
  const truncated = !isStreaming && lines.length > 3;
  const label = isStreaming ? 'thinking...' : `thought (${lines.length} lines)`;

  return (
    <Box flexDirection="column" marginLeft={3}>
      <Text color={colors.dim}>{icons.thinking} {label}</Text>
      <Box flexDirection="column" marginLeft={2} borderStyle="single"
        borderColor={colors.dimmer} borderLeft borderTop={false} borderRight={false} borderBottom={false}
        paddingLeft={1}
      >
        {show.map((line, i) => (
          <Text key={i} color={colors.dim} wrap="wrap">{line}</Text>
        ))}
        {truncated && <Text color={colors.dimmer}>... ({lines.length - 3} more lines)</Text>}
      </Box>
    </Box>
  );
};

// ─── MessageBubble ───────────────────────────────────────────────────────────

// Simple markdown-like renderer for terminal
const renderContent = (content: string): ReactNode[] => {
  const parts: ReactNode[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        parts.push(
          <Box key={`code-${li}`} flexDirection="column" marginLeft={1} borderStyle="single" borderColor={colors.dimmer} borderLeft borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
            {codeLang && <Text color={colors.dim}>{codeLang}</Text>}
            {codeLines.map((cl, ci) => (
              <Text key={ci} color={colors.cyan}>{cl}</Text>
            ))}
          </Box>
        );
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Regular line with inline formatting
    if (line.startsWith('# ')) {
      parts.push(<Text key={li} color={colors.brand} bold>{line.slice(2)}</Text>);
    } else if (line.startsWith('## ')) {
      parts.push(<Text key={li} color={colors.cyan} bold>{line.slice(3)}</Text>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      parts.push(<Text key={li} color={colors.text} wrap="wrap">  {icons.dot} {line.slice(2)}</Text>);
    } else if (/^\d+\.\s/.test(line)) {
      parts.push(<Text key={li} color={colors.text} wrap="wrap">  {line}</Text>);
    } else {
      // Inline code: replace `code` with styled version
      parts.push(<Text key={li} color={colors.text} wrap="wrap">{line}</Text>);
    }
  }

  // Handle unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    parts.push(
      <Box key="code-end" flexDirection="column" marginLeft={1} borderStyle="single" borderColor={colors.dimmer} borderLeft borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
        {codeLang && <Text color={colors.dim}>{codeLang}</Text>}
        {codeLines.map((cl, ci) => (
          <Text key={ci} color={colors.cyan}>{cl}</Text>
        ))}
      </Box>
    );
  }

  return parts;
};

export const MessageBubble: FC<{
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}> = ({ role, content, isStreaming }) => {
  const isUser = role === 'user';
  const header = isUser ? `${icons.user} You` : `${icons.friday} Friday${isStreaming ? ' ...' : ''}`;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={isUser ? colors.cyan : colors.brand} bold>{header}</Text>
      <Box flexDirection="column" marginLeft={3}>
        {isUser ? (
          <Text color={colors.text} wrap="wrap">{content}</Text>
        ) : (
          <>
            {renderContent(content)}
            {isStreaming && <Text color={colors.brand}>▎</Text>}
          </>
        )}
      </Box>
    </Box>
  );
};

// ─── Toast ───────────────────────────────────────────────────────────────────
const toastStyle: Record<string, { color: string; icon: string }> = {
  info: { color: colors.blue, icon: icons.info },
  success: { color: colors.green, icon: icons.ok },
  error: { color: colors.red, icon: icons.fail },
  warning: { color: colors.amber, icon: icons.warn },
};

export const Toast: FC<{ message: string; type?: string }> = ({ message, type = 'info' }) => {
  const s = toastStyle[type] || toastStyle.info!;
  return (
    <Box marginLeft={1}>
      <Text color={s.color}>{s.icon} {message}</Text>
    </Box>
  );
};

// ─── HelpView ────────────────────────────────────────────────────────────────
const helpItems = [
  ['/help', 'Show this help'],
  ['/model', 'Select AI model & provider'],
  ['/provider', 'Manage API keys'],
  ['/scope <path>', 'Change working directory'],
  ['/clear', 'Clear conversation'],
  ['/history', 'Show message count'],
  ['/exit', 'Exit Friday Code'],
  ['@file', 'Mention file as context'],
];

export const HelpView: FC = () => (
  <Box flexDirection="column" marginLeft={1} marginTop={1}>
    <Text color={colors.brand} bold>{icons.friday} Commands</Text>
    <Box flexDirection="column" marginTop={1}>
      {helpItems.map(([cmd, desc]) => (
        <Text key={cmd} color={colors.text}>{`  ${(cmd || '').padEnd(18)}${desc}`}</Text>
      ))}
    </Box>
    <Text color={colors.dim}>
      {'\n'}Ctrl+C cancel · Ctrl+D exit · Tab autocomplete
    </Text>
  </Box>
);

// ─── Divider ─────────────────────────────────────────────────────────────────
export const Divider: FC<{ label?: string }> = ({ label }) => (
  <Box marginY={0} paddingX={1}>
    <Text color={colors.dimmer}>{'─'.repeat(label ? 4 : 40)}{label ? ` ${label} ` : ''}{'─'.repeat(label ? 30 : 0)}</Text>
  </Box>
);

// ─── WelcomeScreen ───────────────────────────────────────────────────────────
export const WelcomeScreen: FC<{
  model?: string;
  provider?: string;
  scope?: string;
}> = ({ model = 'not set', provider = '', scope = '.' }) => (
  <Box flexDirection="column" marginX={1} marginTop={1}>
    <Box flexDirection="column">
      <Text color={colors.brand} bold>{'    ╔════════════════════════════════════╗'}</Text>
      <Text color={colors.brand} bold>{`    ║ ${icons.friday} F R I D A Y   C O D E         ║`}</Text>
      <Text color={colors.brand} bold>{`    ║ AI terminal coding agent v0.1     ║`}</Text>
      <Text color={colors.brand} bold>{'    ╚════════════════════════════════════╝'}</Text>
    </Box>
    <Box flexDirection="column" marginLeft={5} marginTop={1}>
      <Text color={colors.textSecondary}>{`Model  ${provider ? `${provider}/${model}` : model}`}</Text>
      <Text color={colors.textSecondary}>{`Scope  ${scope}`}</Text>
    </Box>
    <Box marginLeft={5} marginTop={1}>
      <Text color={colors.dim}>{`Type a message to start ${icons.dot} /help for commands ${icons.dot} Ctrl+D exit`}</Text>
    </Box>
  </Box>
);
