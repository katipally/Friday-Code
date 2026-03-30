import React, { useEffect, useState, type FC, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { colors, icons } from '../theme/theme.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ═══════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════

export interface TimelineNodeView {
  id: string;
  kind: 'phase' | 'step' | 'thinking' | 'tool-call' | 'tool-result' | 'text' | 'subagent' | 'done' | 'approval';
  label: string;
  detail?: string;
  stepNumber?: number;
  status?: 'running' | 'done' | 'error';
  toolCallId?: string;
}

export type RunStatusView = 'running' | 'complete' | 'error' | 'cancelled';

// ═══════════════════════════════════════════════════
// PRIMITIVES
// ═══════════════════════════════════════════════════

export const Spinner: FC<{ label?: string; color?: string }> = ({
  label,
  color = colors.primary,
}) => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIndex(i => (i + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <Text color={color}>
      {SPINNER_FRAMES[index]}{label ? ` ${label}` : ''}
    </Text>
  );
};

export const Panel: FC<{
  title?: string;
  borderColor?: string;
  children: ReactNode;
  width?: number | string;
}> = ({ title, borderColor = colors.faint, children, width }) => (
  <Box flexDirection="column" width={width}>
    {title ? <Text color={borderColor}>{title}</Text> : null}
    <Box flexDirection="column" paddingLeft={1}>{children}</Box>
  </Box>
);

// ═══════════════════════════════════════════════════
// SPINE HELPERS
// ═══════════════════════════════════════════════════

const SL: FC<{ children: string; color?: string }> = ({ children: text, color = colors.secondary }) => (
  <Text>
    <Text color={colors.faint}>{'  \u2502 '}</Text>
    <Text color={color}>{text}</Text>
  </Text>
);

const SG: FC = () => <Text color={colors.faint}>{'  \u2502'}</Text>;

// ═══════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════

export const HeaderBar: FC<{
  provider?: string;
  model?: string;
  scope?: string;
  status: string;
  compact?: boolean;
}> = ({ provider = '', model = 'none', scope = '.', status }) => {
  const ml = provider ? `${provider}/${model}` : model;
  const isRunning = status === 'running';
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setTick(i => (i + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [isRunning]);

  const statusText = status === 'idle' ? ''
    : isRunning ? ` ${SPINNER_FRAMES[tick]} working`
    : ` · ${status}`;
  const statusColor = status === 'complete' ? colors.success
    : status === 'error' ? colors.error
    : isRunning ? colors.warn
    : colors.primary;

  return (
    <Box marginBottom={1}>
      <Text>
        <Text color={colors.primary} bold>{icons.friday}</Text>
        <Text color={colors.muted}>{' friday'}</Text>
        <Text color={colors.subtle}>{' · '}</Text>
        <Text color={colors.secondary}>{ml}</Text>
        <Text color={colors.subtle}>{' · '}</Text>
        <Text color={colors.muted}>{scope}</Text>
        {statusText ? <Text color={statusColor}>{statusText}</Text> : null}
      </Text>
    </Box>
  );
};

// ═══════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════

export const StatusBar: FC<{
  tokens?: { prompt: number; completion: number };
  status?: string;
  engineStatus: string;
  compact?: boolean;
}> = ({ tokens, status, engineStatus }) => {
  if (engineStatus === 'idle' && !tokens) {
    return <Text color={colors.faint}>{'  ready'}</Text>;
  }
  const parts = [
    status || engineStatus,
    tokens ? `${tokens.prompt}+${tokens.completion} tok` : '',
  ].filter(Boolean);
  return <Text color={colors.faint}>{`  ${parts.join(' · ')}`}</Text>;
};

// ═══════════════════════════════════════════════════
// KEYBOARD BAR
// ═══════════════════════════════════════════════════

export const KeyboardBar: FC<{
  isGenerating: boolean;
  compact?: boolean;
  pendingApproval?: boolean;
  canRetry?: boolean;
}> = ({ isGenerating, compact = false, pendingApproval = false, canRetry = false }) => {
  if (pendingApproval) {
    return <Text color={colors.warn}>{`  Enter approve · Esc deny`}</Text>;
  }
  if (canRetry && !isGenerating) {
    return <Text color={colors.faint}>{`  r retry · Enter send · Ctrl+D exit`}</Text>;
  }
  const keys = compact
    ? ['Enter send', 'Tab complete', isGenerating ? 'Ctrl+C stop' : 'Ctrl+D exit']
    : ['Enter send', 'Tab complete', '↑ history', isGenerating ? 'Ctrl+C stop' : 'Ctrl+D exit'];
  return <Text color={colors.faint}>{`  ${keys.join(' · ')}`}</Text>;
};

// ═══════════════════════════════════════════════════
// WELCOME SCREEN
// ═══════════════════════════════════════════════════

export const WelcomeScreen: FC<{
  model?: string;
  provider?: string;
  scope?: string;
  compact?: boolean;
}> = ({ model = 'not set', provider = '', scope = '.', compact = false }) => (
  <Box flexDirection="column">
    <Text color={colors.primary} bold>{'  \u25c8 friday code'}</Text>
    <SG />
    <SL color={colors.secondary}>{`model \u2192 ${provider ? `${provider}/` : ''}${model}`}</SL>
    <SL color={colors.secondary}>{`scope \u2192 ${scope}`}</SL>
    <SG />
    <SL color={colors.text}>{'Set a goal to begin.'}</SL>
    <SG />
    <SL color={colors.muted}>{'\u00b7 explain this project'}</SL>
    <SL color={colors.muted}>{'\u00b7 find and fix bugs in @file'}</SL>
    {!compact && <SL color={colors.muted}>{'\u00b7 refactor this module for clarity'}</SL>}
    <SL color={colors.muted}>{'\u00b7 /help for all commands'}</SL>
  </Box>
);

// ═══════════════════════════════════════════════════
// MESSAGE BUBBLE
// ═══════════════════════════════════════════════════

export const MessageBubble: FC<{
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  viewportWidth?: number;
}> = ({ role, content, isStreaming, viewportWidth }) => {
  if (role === 'user') {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={colors.info}>{'  \u25cf '}</Text>
          <Text color={colors.text} bold>{'you'}</Text>
        </Text>
        {content.split('\n').slice(0, 6).map((line, i) => (
          <SL key={i} color={colors.text}>{line}</SL>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.primary}>{'  \u25c8 '}</Text>
        <Text color={colors.text}>{'friday'}</Text>
      </Text>
      {renderSpineContent(content, false, viewportWidth)}
      {isStreaming && <Text color={colors.primary}>{'  \u2502 \u258c'}</Text>}
    </Box>
  );
};

// ═══════════════════════════════════════════════════
// RUN TIMELINE CARD
// ═══════════════════════════════════════════════════

export const RunTimelineCard: FC<{
  status: RunStatusView;
  nodes: TimelineNodeView[];
  isStreaming?: boolean;
  compact?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}> = ({ status, nodes, isStreaming = false, compact = false, viewportWidth, viewportHeight }) => {
  const windowSize = compact ? 10 : 18;
  const visible = nodes.slice(-windowSize);
  const hidden = Math.max(0, nodes.length - visible.length);

  // Calculate how many lines text content can use.
  // Reserve space for: header(2), input(3), keyboard(1), status(1), hidden-indicator(1)
  const fixedOverhead = 8;
  // Each non-text node uses ~1.5 lines (content + gap)
  const nonTextNodes = visible.filter(n => n.kind !== 'text');
  const nonTextLines = Math.ceil(nonTextNodes.length * 1.6) + 3; // +3 for done SG, user msg
  const maxTextLines = Math.max(4, (viewportHeight || 24) - fixedOverhead - nonTextLines);

  return (
    <Box flexDirection="column">
      {hidden > 0 && (
        <Text color={colors.faint}>{`  ┄ ${hidden} earlier event${hidden === 1 ? '' : 's'}`}</Text>
      )}

      {visible.map((node, i) => {
        const isLast = i === visible.length - 1;
        const streaming = isStreaming && isLast && node.status === 'running';
        return (
          <Box key={node.id} flexDirection="column">
            {renderSpineNode(node, streaming, compact, viewportWidth, node.kind === 'text' ? maxTextLines : undefined)}
            {!isLast && node.kind !== 'tool-call' && <SG />}
          </Box>
        );
      })}

      {status === 'error' && <Text color={colors.error}>{'  ✕ run failed'}</Text>}
      {status === 'cancelled' && <Text color={colors.warn}>{'  ! cancelled'}</Text>}
    </Box>
  );
};

// ═══════════════════════════════════════════════════
// COLLAPSED RUN SUMMARY (for past completed runs)
// ═══════════════════════════════════════════════════

export const CollapsedRunCard: FC<{
  nodes: TimelineNodeView[];
  status: RunStatusView;
}> = ({ nodes, status }) => {
  const toolCalls = nodes.filter(n => n.kind === 'tool-call');
  const textNode = [...nodes].reverse().find(n => n.kind === 'text');
  const preview = textNode?.detail?.replace(/[\n\r]+/g, ' ').replace(/\*\*/g, '').replace(/`/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 80) || '';
  const doneNode = nodes.find(n => n.kind === 'done');
  const stepCount = doneNode?.detail?.match(/(\d+)\s*step/)?.[1] || doneNode?.label?.match(/(\d+)\s*step/)?.[1] || '1';
  const statusIcon = status === 'complete' ? icons.ok : status === 'error' ? icons.fail : '○';
  const statusColor = status === 'complete' ? colors.success : status === 'error' ? colors.error : colors.faint;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={statusColor}>{`  ${statusIcon} `}</Text>
        <Text color={colors.muted}>{`${stepCount} step${stepCount === '1' ? '' : 's'}`}</Text>
        {toolCalls.length > 0 && <Text color={colors.faint}>{` · ${toolCalls.length} tool${toolCalls.length === 1 ? '' : 's'}`}</Text>}
        {preview ? <Text color={colors.faint}>{` · ${preview}${preview.length >= 80 ? '…' : ''}`}</Text> : null}
      </Text>
    </Box>
  );
};

// ═══════════════════════════════════════════════════
// TOAST, HELP, DIVIDER
// ═══════════════════════════════════════════════════

export const Toast: FC<{ message: string; type?: string }> = ({ message, type = 'info' }) => (
  <Text color={toneColor(normalizeTone(type))}>{`  ${toneBullet(normalizeTone(type))} ${message}`}</Text>
);

const helpItems = [
  ['/help', 'commands & shortcuts'],
  ['/model', 'switch model'],
  ['/provider', 'manage provider keys'],
  ['/scope <path>', 'change working scope'],
  ['/clear', 'clear conversation'],
  ['/new', 'new conversation'],
  ['/history', 'message count'],
  ['/exit', 'quit friday code'],
  ['@file', 'inject file as context'],
] as const;

export const HelpView: FC = () => (
  <Box flexDirection="column">
    <Text color={colors.primary}>{'  \u25c8 commands'}</Text>
    {helpItems.map(([cmd, desc]) => (
      <Text key={cmd}>
        <Text color={colors.faint}>{'  \u2502 '}</Text>
        <Text color={colors.text}>{cmd.padEnd(16)}</Text>
        <Text color={colors.muted}>{desc}</Text>
      </Text>
    ))}
    <Text color={colors.faint}>{'  \u2502'}</Text>
    <Text>
      <Text color={colors.faint}>{'  \u2502 '}</Text>
      <Text color={colors.subtle}>{`Enter send \u00b7 Tab complete \u00b7 \u2191 history \u00b7 Ctrl+C stop`}</Text>
    </Text>
  </Box>
);

export const Divider: FC<{ label?: string }> = ({ label }) => (
  <Text color={colors.faint}>{`  ${'─'.repeat(4)}${label ? ` ${label} ` : ''}${'─'.repeat(16)}`}</Text>
);

// ═══════════════════════════════════════════════════
// SPINE NODE RENDERER
// ═══════════════════════════════════════════════════

function renderSpineNode(node: TimelineNodeView, streaming: boolean, compact: boolean, viewportWidth?: number, maxTextLines?: number): ReactNode {
  const ic = nodeIcon(node);
  const col = nodeColor(node);
  const detailLines = compact ? 1 : 2;
  // Available text width for detail content (5 = "  │ " prefix)
  const maxDetail = viewportWidth ? Math.max(20, viewportWidth - 8) : (compact ? 48 : 72);
  const detailLimit = Math.min(maxDetail, compact ? 60 : 120);

  switch (node.kind) {
    case 'thinking': {
      const thinkPreview = node.detail ? trunc(summarizeBlock(node.detail, detailLines), detailLimit) : '';
      return (
        <Box flexDirection="column">
          <Text wrap="truncate">
            <Text color={col}>{`  ${ic} `}</Text>
            <Text color={colors.muted}>{'thinking'}</Text>
            {node.stepNumber ? <Text color={colors.subtle}>{` \u00b7 step ${node.stepNumber}`}</Text> : null}
            {streaming ? <Text color={colors.primary}>{' \u258c'}</Text> : null}
          </Text>
          <Text wrap="truncate">
            <Text color={colors.faint}>{'  \u2502 '}</Text>
            <Text color={colors.subtle}>{thinkPreview ? `\u2504 ${thinkPreview}` : ''}</Text>
          </Text>
        </Box>
      );
    }

    case 'tool-call': {
      const toolName = extractToolName(node.label);
      // Show args inline after tool name to avoid re-render artifacts
      const argsDisplay = node.detail ? ` → ${trunc(node.detail, Math.max(10, maxDetail - toolName.length - 4))}` : '';
      return (
        <Text wrap="truncate">
          <Text color={col}>{`  ${ic} `}</Text>
          <Text color={node.status === 'running' ? colors.warn : colors.secondary}>{toolName}</Text>
          {argsDisplay ? <Text color={colors.subtle}>{argsDisplay}</Text> : null}
          {streaming ? <Text color={colors.warn}>{' \u258c'}</Text> : null}
        </Text>
      );
    }

    case 'tool-result': {
      // Strip newlines to prevent multi-line bleeding without spine prefix
      const resultDetail = (node.detail || node.label).replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      return (
        <Text wrap="truncate">
          <Text color={colors.faint}>{'  \u2502 '}</Text>
          <Text color={node.status === 'error' ? colors.error : colors.success}>
            {`${node.status === 'error' ? '\u2715' : '\u2713'} `}
          </Text>
          <Text color={node.status === 'error' ? colors.error : colors.muted}>
            {trunc(resultDetail, maxDetail)}
          </Text>
        </Text>
      );
    }

    case 'phase':
      return (
        <Text wrap="truncate">
          <Text color={colors.primary}>{`  ${icons.running} `}</Text>
          <Text color={colors.secondary}>{node.label}</Text>
        </Text>
      );

    case 'step':
      return (
        <Text wrap="truncate">
          <Text color={node.status === 'done' ? colors.success : node.status === 'error' ? colors.error : colors.primary}>
            {`  ${node.status === 'done' ? '\u2713' : node.status === 'error' ? '\u2715' : '\u25c6'} `}
          </Text>
          <Text color={colors.secondary}>{node.label}</Text>
          {node.detail ? <Text color={colors.subtle}>{` \u00b7 ${trunc(node.detail, Math.min(maxDetail, 40))}`}</Text> : null}
        </Text>
      );

    case 'text': {
      // Trim leading/trailing blank lines to avoid double spine gaps
      const trimmedDetail = (node.detail || '').replace(/^\n+/, '').replace(/(\n\s*)+$/, '');
      return (
        <Box flexDirection="column">
          <Text key="resp-hdr">
            <Text color={colors.primary}>{'  \u25c8 '}</Text>
            <Text color={colors.text}>{streaming ? 'responding' : 'response'}</Text>
          </Text>
          {trimmedDetail ? renderSpineContent(trimmedDetail, compact, viewportWidth, maxTextLines) : null}
          {streaming && <Text key="resp-cursor" color={colors.primary}>{'  \u2502 \u258c'}</Text>}
        </Box>
      );
    }

    case 'subagent':
      return (
        <Text>
          <Text color={colors.info}>{`  ${icons.detach} `}</Text>
          <Text color={colors.secondary}>{node.label}</Text>
        </Text>
      );

    case 'approval':
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={colors.warn}>{`  ${icons.warn} `}</Text>
            <Text color={colors.text} bold>{'approve '}</Text>
            <Text color={colors.secondary}>{node.label}</Text>
            {node.detail ? <Text color={colors.faint}>{` ${icons.arrow} ${node.detail}`}</Text> : null}
          </Text>
          {node.status === 'running' && (
            <Text color={colors.muted}>{'  \u2502   '}<Text color={colors.warn}>{'Enter'}</Text>{' approve \u00b7 '}<Text color={colors.error}>{'Esc'}</Text>{' deny'}</Text>
          )}
          {node.status === 'done' && (
            <Text color={colors.success}>{'  \u2502   \u2713 approved'}</Text>
          )}
          {node.status === 'error' && (
            <Text color={colors.error}>{'  \u2502   \u2715 denied'}</Text>
          )}
        </Box>
      );

    case 'done':
      return (
        <Text wrap="truncate">
          <Text color={colors.success}>{'  \u2713 '}</Text>
          <Text color={colors.secondary}>{'done'}</Text>
          {node.detail ? <Text color={colors.muted}>{` \u00b7 ${node.detail}`}</Text> : null}
        </Text>
      );

    default:
      return <Text color={colors.muted}>{`  \u00b7 ${node.label}`}</Text>;
  }
}

function extractToolName(label: string): string {
  const parts = label.split('\u00b7');
  return (parts.length > 2 ? parts[parts.length - 1] : parts[0] || label).trim();
}

// ═══════════════════════════════════════════════════
// MARKDOWN SPINE CONTENT RENDERER
// ═══════════════════════════════════════════════════

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) maxWidth = 80;
  const words = text.split(' ');
  let currentLine = '';
  const lines: string[] = [];
  for (const word of words) {
    if (currentLine && (currentLine.length + 1 + word.length) > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

function renderSpineContent(content: string, compact: boolean, maxWidth?: number, lineLimitOverride?: number): ReactNode[] {
  const lines = content.split('\n');
  const result: ReactNode[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  const lineLimit = lineLimitOverride ?? (compact ? 6 : 16);
  const textWidth = maxWidth ? maxWidth - 5 : 100; // 5 = '  │ ' prefix

  for (let i = 0; i < Math.min(lines.length, lineLimit); i++) {
    const line = lines[i]!;

    if (line.startsWith('```')) {
      if (inCode) {
        if (codeLang) {
          result.push(
            <Text key={`ch-${i}`}>
              <Text color={colors.faint}>{'  \u2502 '}</Text>
              <Text color={colors.subtle}>{`\u2500 ${codeLang} \u2500`}</Text>
            </Text>
          );
        }
        for (const [ci, cl] of codeLines.entries()) {
          result.push(
            <Text key={`c-${i}-${ci}`}>
              <Text color={colors.faint}>{'  \u2502   '}</Text>
              <Text color={colors.primaryBright}>{cl}</Text>
            </Text>
          );
        }
        result.push(
          <Text key={`ce-${i}`}>
            <Text color={colors.faint}>{'  \u2502 '}</Text>
            <Text color={colors.subtle}>{'\u2500'}</Text>
          </Text>
        );
        codeLines = [];
        codeLang = '';
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) { codeLines.push(line); continue; }

    // Trim leading whitespace for pattern matching, but preserve indent level
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const indentStr = indent > 0 ? ' '.repeat(Math.min(indent, 4)) : '';

    if (trimmed.startsWith('# ')) {
      result.push(<Text key={i}><Text color={colors.faint}>{'  \u2502 '}</Text><Text color={colors.primary} bold>{trimmed.slice(2)}</Text></Text>);
    } else if (trimmed.startsWith('## ')) {
      result.push(<Text key={i}><Text color={colors.faint}>{'  \u2502 '}</Text><Text color={colors.primaryBright} bold>{trimmed.slice(3)}</Text></Text>);
    } else if (trimmed.startsWith('### ')) {
      result.push(<Text key={i}><Text color={colors.faint}>{'  \u2502 '}</Text><Text color={colors.secondary} bold>{trimmed.slice(4)}</Text></Text>);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const prefix = `${indentStr}\u00b7 `;
      const contentText = trimmed.slice(2);
      const prefixWidth = 4 + prefix.length; // '  │ ' + prefix
      const wrapWidth = textWidth - prefix.length;
      const wrapped = wrapText(contentText, wrapWidth);
      for (const [wi, wl] of wrapped.entries()) {
        result.push(
          <Text key={`${i}-${wi}`}>
            <Text color={colors.faint}>{'  \u2502 '}</Text>
            {wi === 0 ? <Text color={colors.subtle}>{prefix}</Text> : <Text>{' '.repeat(prefix.length)}</Text>}
            {renderInlineMarkdown(wl, `md-${i}-${wi}`)}
          </Text>
        );
      }
    } else if (trimmed.match(/^\d+\. /)) {
      const numEnd = trimmed.indexOf('. ');
      const num = trimmed.slice(0, numEnd + 2);
      const rest = trimmed.slice(numEnd + 2);
      const prefix = `${indentStr}${num}`;
      const wrapWidth = textWidth - prefix.length;
      const wrapped = wrapText(rest, wrapWidth);
      for (const [wi, wl] of wrapped.entries()) {
        result.push(
          <Text key={`${i}-${wi}`}>
            <Text color={colors.faint}>{'  \u2502 '}</Text>
            {wi === 0 ? <Text color={colors.subtle}>{prefix}</Text> : <Text>{' '.repeat(prefix.length)}</Text>}
            {renderInlineMarkdown(wl, `md-${i}-${wi}`)}
          </Text>
        );
      }
    } else if (trimmed === '') {
      result.push(<Text key={i} color={colors.faint}>{'  \u2502'}</Text>);
    } else {
      // Manually wrap long lines to keep spine prefix on each visual line
      const wrapped = wrapText(line, textWidth);
      for (const [wi, wl] of wrapped.entries()) {
        result.push(<Text key={`${i}-${wi}`}><Text color={colors.faint}>{'  \u2502 '}</Text>{renderInlineMarkdown(wl, `md-${i}-${wi}`)}</Text>);
      }
    }
  }

  if (lines.length > lineLimit) {
    result.push(<Text key="trunc" color={colors.faint}>{`  \u2502 \u2504 ${lines.length - lineLimit} more lines`}</Text>);
  }

  if (inCode && codeLines.length > 0) {
    for (const [ci, cl] of codeLines.entries()) {
      result.push(<Text key={`ct-${ci}`}><Text color={colors.faint}>{'  \u2502   '}</Text><Text color={colors.primaryBright}>{cl}</Text></Text>);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════
// INLINE MARKDOWN RENDERER
// ═══════════════════════════════════════════════════

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode {
  // Parse inline markdown: **bold**, *italic*, `code`
  const parts: ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  while (remaining.length > 0) {
    // Try `code` first (highest priority - no nesting inside code)
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <Text key={`${keyPrefix}-${idx}`} color={colors.accent}>{codeMatch[1]}</Text>
      );
      remaining = remaining.slice(codeMatch[0].length);
      idx++;
      continue;
    }

    // Try **bold**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <Text key={`${keyPrefix}-${idx}`} bold>{boldMatch[1]}</Text>
      );
      remaining = remaining.slice(boldMatch[0].length);
      idx++;
      continue;
    }

    // Try *italic*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(
        <Text key={`${keyPrefix}-${idx}`} italic dimColor>{italicMatch[1]}</Text>
      );
      remaining = remaining.slice(italicMatch[0].length);
      idx++;
      continue;
    }

    // Find the next special character
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) {
      // No more markdown — push rest as plain text
      parts.push(<Text key={`${keyPrefix}-${idx}`}>{remaining}</Text>);
      break;
    } else if (nextSpecial === 0) {
      // Special char that didn't match a pattern — treat as literal
      parts.push(<Text key={`${keyPrefix}-${idx}`}>{remaining[0]}</Text>);
      remaining = remaining.slice(1);
      idx++;
    } else {
      // Plain text before the next special
      parts.push(<Text key={`${keyPrefix}-${idx}`}>{remaining.slice(0, nextSpecial)}</Text>);
      remaining = remaining.slice(nextSpecial);
      idx++;
    }
  }

  return <>{parts}</>;
}

// ═══════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════

function nodeIcon(node: TimelineNodeView): string {
  switch (node.kind) {
    case 'thinking': return '\u25c6';
    case 'tool-call': return '\u25c7';
    case 'tool-result': return node.status === 'error' ? '\u2715' : '\u2713';
    case 'text': return '\u25c8';
    case 'phase': return '\u25ce';
    case 'step': return node.status === 'done' ? '\u2713' : node.status === 'error' ? '\u2715' : '\u25c6';
    case 'subagent': return '\u25eb';
    default: return '\u00b7';
  }
}

function nodeColor(node: TimelineNodeView): string {
  switch (node.kind) {
    case 'thinking': return colors.muted;
    case 'tool-call': return node.status === 'error' ? colors.error : colors.warn;
    case 'tool-result': return node.status === 'error' ? colors.error : colors.success;
    case 'text': return colors.primary;
    case 'phase': return colors.primary;
    case 'step': return node.status === 'error' ? colors.error : node.status === 'done' ? colors.success : colors.primary;
    case 'subagent': return colors.info;
    default: return colors.muted;
  }
}

type ToneType = 'info' | 'success' | 'warning' | 'error' | 'muted' | 'accent';

export function toneColor(tone: ToneType): string {
  switch (tone) {
    case 'success': return colors.success;
    case 'warning': return colors.warn;
    case 'error': return colors.error;
    case 'accent': return colors.primary;
    case 'info': return colors.info;
    default: return colors.muted;
  }
}

export function toneBullet(tone: ToneType): string {
  switch (tone) {
    case 'success': return '\u2713';
    case 'warning': return '!';
    case 'error': return '\u2715';
    case 'accent': return '\u25c6';
    case 'info': return 'i';
    default: return '\u00b7';
  }
}

function normalizeTone(type: string): ToneType {
  if (type === 'success' || type === 'warning' || type === 'error' || type === 'accent' || type === 'info') return type;
  return 'muted';
}

export function summarizeBlock(text: string | undefined, maxLines: number): string {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines.join(' ');
  return `${lines.slice(0, maxLines).join(' ')} \u2026`;
}

function trunc(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}\u2026` : text;
}

export function truncateInline(text: string, limit: number): string {
  return trunc(text, limit);
}
