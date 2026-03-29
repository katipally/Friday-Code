import React, { useState, useCallback, useMemo, type FC } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons, SLASH_COMMANDS } from '../theme/theme.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, relative, join, basename, dirname } from 'path';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  isGenerating: boolean;
  onCancel: () => void;
  workingDirectory: string;
}

export const InputBox: FC<InputBoxProps> = ({
  onSubmit,
  isGenerating,
  onCancel,
  workingDirectory,
}) => {
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [acIndex, setAcIndex] = useState(0);

  // Compute autocomplete suggestions
  const suggestions = useMemo(() => {
    if (!input || isGenerating) return [];

    // Slash command autocomplete
    if (input.startsWith('/')) {
      return SLASH_COMMANDS
        .filter(c => c.cmd.startsWith(input.toLowerCase()))
        .map(c => ({ value: c.cmd, label: `${c.cmd}  ${c.desc}` }));
    }

    // @ file autocomplete
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
            const full = partial.includes('/')
              ? dirname(partial) + '/' + f
              : f;
            const isDir = statSync(join(dir, f)).isDirectory();
            return { value: '@' + full + (isDir ? '/' : ''), label: (isDir ? '/' : ' ') + f };
          });
      } catch { return []; }
    }

    return [];
  }, [input, isGenerating, workingDirectory]);

  useInput((ch, key) => {
    // Ctrl+C = cancel
    if (key.ctrl && ch === 'c') {
      if (isGenerating) onCancel();
      return;
    }
    // Ctrl+D = exit
    if (key.ctrl && ch === 'd') {
      process.exit(0);
    }
    if (isGenerating) return;

    // Tab = accept autocomplete
    if (key.tab && suggestions.length > 0) {
      const pick = suggestions[acIndex % suggestions.length];
      if (pick) {
        if (input.startsWith('/')) {
          setInput(pick.value + ' ');
          setCursorPos(pick.value.length + 1);
        } else {
          // replace the @partial with the full value
          const replaced = input.replace(/@[\w./\-]*$/, pick.value);
          setInput(replaced);
          setCursorPos(replaced.length);
        }
        setAcIndex(0);
      }
      return;
    }

    // Enter = submit
    if (key.return) {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Expand file mentions
      let processed = trimmed;
      const mentions = trimmed.match(/@([\w./\-]+)/g);
      if (mentions) {
        for (const m of mentions) {
          const fp = m.slice(1);
          const full = resolve(workingDirectory, fp);
          if (existsSync(full) && !statSync(full).isDirectory()) {
            try {
              const content = readFileSync(full, 'utf-8');
              processed = processed.replace(
                m,
                `\n[File: ${fp}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`\n`
              );
            } catch {}
          }
        }
      }

      setHistory(prev => [trimmed, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      setInput('');
      setCursorPos(0);
      setAcIndex(0);
      onSubmit(processed);
      return;
    }

    // History ↑↓
    if (key.upArrow && history.length > 0) {
      const ni = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(ni);
      const h = history[ni]!;
      setInput(h);
      setCursorPos(h.length);
      return;
    }
    if (key.downArrow) {
      if (historyIdx > 0) {
        const ni = historyIdx - 1;
        setHistoryIdx(ni);
        const h = history[ni]!;
        setInput(h);
        setCursorPos(h.length);
      } else {
        setHistoryIdx(-1);
        setInput('');
        setCursorPos(0);
      }
      return;
    }

    // Cursor
    if (key.leftArrow) { setCursorPos(p => Math.max(0, p - 1)); return; }
    if (key.rightArrow) { setCursorPos(p => Math.min(input.length, p + 1)); return; }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInput(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(p => p - 1);
      }
      return;
    }

    // Ctrl+U = clear
    if (key.ctrl && ch === 'u') {
      setInput(''); setCursorPos(0); return;
    }

    // Escape = cycle autocomplete or clear
    if (key.escape) {
      if (suggestions.length > 0) {
        setAcIndex(i => (i + 1) % suggestions.length);
      }
      return;
    }

    // Printable char
    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev.slice(0, cursorPos) + ch + prev.slice(cursorPos));
      setCursorPos(p => p + ch.length);
      setAcIndex(0);
    }
  });

  const before = input.slice(0, cursorPos);
  const rest = input.slice(cursorPos);

  return (
    <Box flexDirection="column">
      {/* Autocomplete dropdown */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginLeft={3}>
          {suggestions.slice(0, 6).map((s, i) => {
            const isSel = i === acIndex % suggestions.length;
            const line = `${isSel ? '▸ ' : '  '}${s.label}`;
            return (
              <Text key={s.value} color={isSel ? colors.cyan : colors.dim}>{line}</Text>
            );
          })}
          <Text color={colors.dim}>  Tab accept · Esc cycle</Text>
        </Box>
      )}
      {/* Input line */}
      <Box borderStyle="round" borderColor={colors.brand} paddingX={1}>
        {input.length === 0 && !isGenerating ? (
          <Text color={colors.dim}>{icons.prompt} Type a message... (/help for commands)</Text>
        ) : isGenerating ? (
          <Text color={colors.amber}>{icons.loading} generating...</Text>
        ) : (
          <Text color={colors.text}>{icons.prompt} {before}<Text color={colors.brand}>▎</Text>{rest}</Text>
        )}
      </Box>
    </Box>
  );
};
