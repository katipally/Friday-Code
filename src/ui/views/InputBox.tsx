import React, { useMemo, useState, type FC } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons, SLASH_COMMANDS } from '../theme/theme.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  isGenerating: boolean;
  onCancel: () => void;
  onApprove?: () => void;
  onDeny?: () => void;
  onRetry?: () => void;
  pendingApproval?: boolean;
  canRetry?: boolean;
  workingDirectory: string;
  phase: string;
  viewportWidth: number;
}

export const InputBox: FC<InputBoxProps> = ({
  onSubmit,
  isGenerating,
  onCancel,
  onApprove,
  onDeny,
  onRetry,
  pendingApproval = false,
  canRetry = false,
  workingDirectory,
  phase,
  viewportWidth,
}) => {
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [acIndex, setAcIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!input || isGenerating) return [];

    if (input.startsWith('/')) {
      return SLASH_COMMANDS
        .filter(c => c.cmd.startsWith(input.toLowerCase()))
        .map(c => ({ value: c.cmd, label: `${c.cmd}  ${c.desc}` }));
    }

    const atMatch = input.match(/@([\w./\-]*)$/);
    if (atMatch) {
      const partial = atMatch[1] || '';
      const dir = partial.includes('/')
        ? resolve(workingDirectory, dirname(partial))
        : workingDirectory;
      const prefix = partial.includes('/') ? basename(partial) : partial;

      try {
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
          .filter(f => f.startsWith(prefix) && !f.startsWith('.'))
          .slice(0, 8)
          .map(f => {
            const full = partial.includes('/') ? `${dirname(partial)}/${f}` : f;
            const isDir = statSync(join(dir, f)).isDirectory();
            return { value: `@${full}${isDir ? '/' : ''}`, label: `${isDir ? '/' : ' '} ${f}` };
          });
      } catch { return []; }
    }

    return [];
  }, [input, isGenerating, workingDirectory]);

  useInput((character, key) => {
    if (key.ctrl && character === 'c') {
      if (isGenerating) onCancel();
      return;
    }
    if (key.ctrl && character === 'd') { process.exit(0); }
    if (isGenerating && !pendingApproval) return;

    // Handle tool approval keybindings
    if (pendingApproval) {
      const isEnter = key.return || character === '\r' || character === '\n' ||
        (character && character.length > 1 && /[\r\n]/.test(character));
      if (isEnter && onApprove) { onApprove(); return; }
      if (key.escape && onDeny) { onDeny(); return; }
      return; // Block all other input during approval
    }

    // Handle retry (only when error state and not generating)
    if (canRetry && character === 'r' && !isGenerating && !input) {
      onRetry?.();
      return;
    }

    if (key.tab && suggestions.length > 0) {
      const picked = suggestions[acIndex % suggestions.length];
      if (picked) {
        if (input.startsWith('/')) {
          setInput(`${picked.value} `);
          setCursorPos(picked.value.length + 1);
        } else {
          const replaced = input.replace(/@[\w./\-]*$/, picked.value);
          setInput(replaced);
          setCursorPos(replaced.length);
        }
      }
      setAcIndex(0);
      return;
    }

    if (suggestions.length > 0 && key.downArrow) { setAcIndex(i => (i + 1) % suggestions.length); return; }
    if (suggestions.length > 0 && key.upArrow) { setAcIndex(i => (i - 1 + suggestions.length) % suggestions.length); return; }

    // Detect Enter: key.return, single \r/\n, OR multi-char chunk containing \r/\n
    // (terminal-sessions/PTY often sends text+newline as one data chunk)
    const hasNewline = key.return || character === '\r' || character === '\n' ||
      (character && character.length > 1 && /[\r\n]/.test(character));

    if (hasNewline) {
      // Extract any extra text before the newline (from pasted/chunked input)
      const extraText = character ? character.replace(/[\r\n]+/g, '') : '';
      const fullInput = extraText
        ? (input.slice(0, cursorPos) + extraText + input.slice(cursorPos)).trim()
        : input.trim();
      if (!fullInput) return;

      let processed = fullInput;
      const mentions = fullInput.match(/@([\w./\-]+)/g);
      if (mentions) {
        for (const mention of mentions) {
          const relativePath = mention.slice(1);
          const fullPath = resolve(workingDirectory, relativePath);
          if (existsSync(fullPath) && !statSync(fullPath).isDirectory()) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              processed = processed.replace(
                mention,
                `\n[File: ${relativePath}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`\n`,
              );
            } catch { /* keep original */ }
          }
        }
      }

      setHistory(prev => [fullInput, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      setInput('');
      setCursorPos(0);
      setAcIndex(0);
      onSubmit(processed);
      return;
    }

    if (key.upArrow && history.length > 0) {
      const next = Math.min(historyIdx + 1, history.length - 1);
      const entry = history[next] || '';
      setHistoryIdx(next);
      setInput(entry);
      setCursorPos(entry.length);
      return;
    }

    if (key.downArrow) {
      if (historyIdx > 0) {
        const next = historyIdx - 1;
        const entry = history[next] || '';
        setHistoryIdx(next);
        setInput(entry);
        setCursorPos(entry.length);
      } else {
        setHistoryIdx(-1);
        setInput('');
        setCursorPos(0);
      }
      return;
    }

    if (key.leftArrow) { setCursorPos(p => Math.max(0, p - 1)); return; }
    if (key.rightArrow) { setCursorPos(p => Math.min(input.length, p + 1)); return; }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(p => p - 1);
      }
      return;
    }

    if (key.ctrl && character === 'u') { setInput(''); setCursorPos(0); return; }
    if (key.escape) { setAcIndex(0); return; }

    if (character && !key.ctrl && !key.meta && !/[\r\n]/.test(character)) {
      setInput(prev => prev.slice(0, cursorPos) + character + prev.slice(cursorPos));
      setCursorPos(p => p + character.length);
      setAcIndex(0);
    }
  });

  const before = input.slice(0, cursorPos);
  const after = input.slice(cursorPos);
  const narrow = viewportWidth < 88;
  const ruler = '\u2500'.repeat(Math.max(8, Math.min(120, viewportWidth - 4)));

  return (
    <Box flexDirection="column" marginTop={1}>
      {suggestions.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colors.subtle}>
            {narrow
              ? `  ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} \u00b7 Tab`
              : `  ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} \u00b7 Tab accept \u00b7 \u2191\u2193 move`}
          </Text>
          {suggestions.slice(0, 6).map((s, i) => {
            const sel = i === acIndex % suggestions.length;
            return (
              <Text key={s.value} color={sel ? colors.primary : colors.subtle}>
                {`  ${sel ? '\u25b8' : ' '} ${truncLabel(s.label, narrow ? Math.max(16, viewportWidth - 6) : Math.max(20, viewportWidth - 10))}`}
              </Text>
            );
          })}
        </Box>
      ) : null}

      <Text color={colors.faint}>{`  ${ruler}`}</Text>

      {input.length === 0 && !isGenerating ? (
        <Text>
          <Text color={colors.muted}>{'  '}</Text>
          <Text color={colors.primary}>{icons.prompt}</Text>
          <Text color={colors.subtle}>{narrow ? ' type a goal...' : ' type a goal, mention @file, or use /command...'}</Text>
        </Text>
      ) : isGenerating ? (
        <Text color={colors.warn}>{`  ${phase} \u00b7 Ctrl+C to stop`}</Text>
      ) : (
        <Text>
          <Text color={colors.muted}>{'  '}</Text>
          <Text color={colors.primary}>{icons.prompt}</Text>
          <Text color={colors.text}>{` ${before}`}</Text>
          <Text color={colors.primary}>{'\u258c'}</Text>
          <Text color={colors.text}>{after}</Text>
        </Text>
      )}
    </Box>
  );
};

function truncLabel(label: string, limit: number): string {
  return label.length > limit ? `${label.slice(0, limit - 1)}\u2026` : label;
}
