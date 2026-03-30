import React, { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Box, Text, useApp, useStdout } from 'ink';
import { colors, icons } from '../theme/theme.js';
import {
  CollapsedRunCard,
  HeaderBar,
  HelpView,
  KeyboardBar,
  MessageBubble,
  RunTimelineCard,
  StatusBar,
  Toast,
  WelcomeScreen,
  type RunStatusView,
  type TimelineNodeView,
} from '../components/components.js';
import { InputBox } from './InputBox.js';
import { ModelSelector } from './ModelSelector.js';
import { AgentEngine, type StreamEvent } from '../../core/engine/agent.js';
import { getSetting, setSetting } from '../../core/providers/registry.js';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

type ChatMessage =
  | { type: 'user'; content: string }
  | {
      type: 'run';
      id: string;
      status: RunStatusView;
      isStreaming: boolean;
      nodes: TimelineNodeView[];
    }
  | { type: 'help' }
  | { type: 'toast'; message: string; toastType: 'info' | 'success' | 'error' | 'warning' }
  | { type: 'error'; message: string };

type EngineStatus = 'idle' | 'running' | 'complete' | 'error';

interface AppProps {
  initialDirectory?: string;
}

const App: FC<AppProps> = ({ initialDirectory }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [activeModel, setActiveModel] = useState(getSetting('active_model') || '');
  const [activeProvider, setActiveProvider] = useState(getSetting('active_provider') || '');
  const [workingDirectory, setWorkingDirectory] = useState(initialDirectory || process.cwd());
  const [tokenUsage, setTokenUsage] = useState<{ prompt: number; completion: number } | undefined>();
  const [statusText, setStatusText] = useState('');
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [showWelcome, setShowWelcome] = useState(true);
  const [termSize, setTermSize] = useState({ cols: stdout?.columns || 80, rows: stdout?.rows || 24 });

  const engineRef = useRef<AgentEngine | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const lastUserMessageRef = useRef<string>('');
  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string;
    toolName: string;
    args: unknown;
  } | null>(null);

  useEffect(() => {
    const onResize = () => {
      if (stdout) {
        setTermSize({ cols: stdout.columns, rows: stdout.rows });
      }
    };

    stdout?.on('resize', onResize);
    return () => {
      stdout?.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    engineRef.current = new AgentEngine({
      workingDirectory,
    });
    engineRef.current.ensureConversation();
  }, []);

  const compact = termSize.cols < 100 || termSize.rows < 24;
  // Each past turn (user + collapsed run) ≈ 3 visual lines.
  // Reserve ~16 lines for current run + header + footer.
  const maxPastTurns = Math.max(1, Math.floor((termSize.rows - 16) / 3));
  const transcriptLimit = Math.max(3, maxPastTurns * 2 + 2); // pairs + current user+run
  const displayScope = fitPath(workingDirectory, Math.max(20, termSize.cols - 24));
  const visibleMessages = messages.slice(-transcriptLimit);
  const hasUserMessages = useMemo(
    () => messages.some(message => message.type === 'user'),
    [messages],
  );
  const showLaunchpad = showWelcome && !hasUserMessages;
  const showKeyboardBar = termSize.rows >= 16;
  const showStatusBar = termSize.rows >= 14;

  const handleCommand = useCallback((input: string): boolean => {
    const parts = input.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();

    switch (command) {
      case '/help':
        setMessages(previous => [...previous, { type: 'help' }]);
        return true;

      case '/model':
      case '/provider':
        setShowModelSelector(true);
        return true;

      case '/clear':
        setMessages([
          {
            type: 'toast',
            message: 'Conversation cleared',
            toastType: 'success',
          },
        ]);
        setTokenUsage(undefined);
        setStatusText('');
        setEngineStatus('idle');
        setShowWelcome(true);
        engineRef.current?.clearHistory();
        engineRef.current?.ensureConversation();
        return true;

      case '/new':
        setMessages([
          {
            type: 'toast',
            message: 'Fresh run ready',
            toastType: 'success',
          },
        ]);
        setTokenUsage(undefined);
        setStatusText('');
        setEngineStatus('idle');
        setShowWelcome(true);
        engineRef.current?.clearHistory();
        engineRef.current?.ensureConversation();
        return true;

      case '/scope': {
        const nextPath = parts[1];
        if (!nextPath) {
          setMessages(previous => [
            ...previous,
            {
              type: 'toast',
              message: `Current scope: ${workingDirectory}`,
              toastType: 'info',
            },
          ]);
          return true;
        }

        const resolved = resolve(workingDirectory, nextPath);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
          setWorkingDirectory(resolved);
          engineRef.current?.setWorkingDirectory(resolved);
          setMessages(previous => [
            ...previous,
            {
              type: 'toast',
              message: `Scope → ${resolved}`,
              toastType: 'success',
            },
          ]);
        } else {
          setMessages(previous => [
            ...previous,
            {
              type: 'toast',
              message: `Directory not found: ${resolved}`,
              toastType: 'error',
            },
          ]);
        }

        return true;
      }

      case '/history':
        setMessages(previous => [
          ...previous,
          {
            type: 'toast',
            message: `${engineRef.current?.getMessageCount() || 0} messages in history`,
            toastType: 'info',
          },
        ]);
        return true;

      case '/config': {
        const key = parts[1];
        const value = parts.slice(2).join(' ');

        if (!key) {
          // Show all config
          const maxSteps = getSetting('max_steps') || '25';
          const approval = engineRef.current?.getApprovalMode() ? 'on' : 'off';
          const model = getSetting('active_model') || 'none';
          const provider = getSetting('active_provider') || 'none';
          setMessages(previous => [
            ...previous,
            { type: 'toast', message: `maxSteps: ${maxSteps} · approval: ${approval} · model: ${provider}/${model}`, toastType: 'info' },
          ]);
          return true;
        }

        const configKeys: Record<string, () => void> = {
          maxSteps: () => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1 || num > 100) {
              setMessages(p => [...p, { type: 'toast', message: 'maxSteps must be 1-100', toastType: 'error' }]);
              return;
            }
            setSetting('max_steps', String(num));
            setMessages(p => [...p, { type: 'toast', message: `maxSteps → ${num}`, toastType: 'success' }]);
          },
          approval: () => {
            const enabled = value === 'on' || value === 'true' || value === '1';
            engineRef.current?.setApprovalMode(enabled);
            setMessages(p => [...p, { type: 'toast', message: `Tool approval → ${enabled ? 'on' : 'off'}`, toastType: 'success' }]);
          },
        };

        const handler = configKeys[key];
        if (handler) {
          handler();
        } else {
          setMessages(p => [...p, { type: 'toast', message: `Unknown config: ${key}. Available: maxSteps, approval`, toastType: 'error' }]);
        }
        return true;
      }

      case '/exit':
        exit();
        return true;

      default:
        return false;
    }
  }, [exit, workingDirectory]);

  const handleSubmit = useCallback(async (input: string) => {
    if (showWelcome) {
      setShowWelcome(false);
    }

    if (input.startsWith('/') && handleCommand(input)) {
      return;
    }

    if (!engineRef.current) {
      return;
    }

    lastUserMessageRef.current = input;
    setIsGenerating(true);
    setEngineStatus('running');
    setStatusText('Working...');
    setTokenUsage(undefined);
    setPendingApproval(null);

    const runId = createMessageId('run');
    activeRunIdRef.current = runId;

    setMessages(previous => [
      ...previous,
      { type: 'user', content: input },
      createRunMessage(runId),
    ]);

    try {
      for await (const event of engineRef.current.run(input)) {
        if (event.type === 'tool-approval-request') {
          // Show approval prompt in timeline
          setMessages(previous => updateRunMessage(previous, runId, run => appendRunNode(run, {
            id: `${run.id}-approval-${event.toolCallId}`,
            kind: 'approval',
            label: event.toolName,
            detail: formatToolArgs(event.toolName, event.args ? JSON.stringify(event.args) : ''),
            stepNumber: event.stepNumber,
            toolCallId: event.toolCallId,
            status: 'running',
          })));
          setPendingApproval({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
          });
          setStatusText(`Approve ${event.toolName}?`);
          continue;
        }

        handleStreamEvent(event, {
          runId,
          setMessages,
          setStatusText,
          setTokenUsage,
          setEngineStatus,
        });
      }
    } catch (error: any) {
      setEngineStatus('error');
      setMessages(previous => markRunErrored(previous, runId, error.message || 'Unknown error'));
    } finally {
      setIsGenerating(false);
      setStatusText('');
      activeRunIdRef.current = null;
      setPendingApproval(null);
    }
  }, [handleCommand, showWelcome]);

  const handleCancel = useCallback(() => {
    engineRef.current?.abort();
    setIsGenerating(false);
    setStatusText('');
    setEngineStatus('idle');
    setMessages(previous => markRunCancelled(previous, activeRunIdRef.current));
    setMessages(previous => [
      ...previous,
      {
        type: 'toast',
        message: 'Generation cancelled',
        toastType: 'warning',
      },
    ]);
  }, []);

  const handleApproval = useCallback((approved: boolean) => {
    if (!pendingApproval || !engineRef.current) return;
    const runId = activeRunIdRef.current;
    engineRef.current.respondToApproval(approved);

    // Update approval node in timeline
    if (runId) {
      setMessages(previous => updateRunMessage(previous, runId, run => {
        const approvalNodeId = `${run.id}-approval-${pendingApproval.toolCallId}`;
        return {
          ...run,
          nodes: run.nodes.map(n =>
            n.id === approvalNodeId
              ? { ...n, status: approved ? ('done' as const) : ('error' as const) }
              : n
          ),
        };
      }));
    }

    setPendingApproval(null);
    setStatusText(approved ? 'Continuing...' : 'Tool denied');
  }, [pendingApproval]);

  const handleRetry = useCallback(() => {
    if (engineStatus !== 'error' || !lastUserMessageRef.current) return;
    handleSubmit(lastUserMessageRef.current);
  }, [engineStatus, handleSubmit]);

  const handleModelSelect = useCallback((providerId: string, modelId: string) => {
    setActiveProvider(providerId);
    setActiveModel(modelId);
    setShowModelSelector(false);
    setMessages(previous => [
      ...previous,
      {
        type: 'toast',
        message: `Model → ${providerId}/${modelId}`,
        toastType: 'success',
      },
    ]);
  }, []);

  return (
    <Box flexDirection="column" width={termSize.cols} height={termSize.rows}>
      <HeaderBar
        provider={activeProvider}
        model={activeModel || 'none'}
        scope={displayScope}
        status={engineStatus}
        compact={compact}
      />

      <Box flexDirection="column" flexGrow={1}>
        {showLaunchpad ? (
          <WelcomeScreen
            model={activeModel}
            provider={activeProvider}
            scope={displayScope}
            compact={compact}
          />
        ) : null}

        <Box flexDirection="column" marginTop={showLaunchpad ? 1 : 0}>
          {visibleMessages.map((message, index) => {
            switch (message.type) {
              case 'user':
                return <MessageBubble key={index} role="user" content={message.content} />;
              case 'run': {
                // Find if this is the last (most recent) run in the transcript
                const isLastRun = !visibleMessages.slice(index + 1).some(m => m.type === 'run');
                if (!isLastRun && message.status !== 'running') {
                  // Collapse past completed runs to save viewport space
                  return <CollapsedRunCard key={message.id} nodes={message.nodes} status={message.status} />;
                }
                return (
                  <RunTimelineCard
                    key={message.id}
                    status={message.status}
                    nodes={message.nodes}
                    isStreaming={message.isStreaming}
                    compact={compact}
                    viewportWidth={termSize.cols}
                    viewportHeight={termSize.rows}
                  />
                );
              }
              case 'help':
                return <HelpView key={index} />;
              case 'toast':
                return <Toast key={index} message={message.message} type={message.toastType} />;
              case 'error':
                return <Text key={index} color={colors.red}>{`  ${icons.fail} ${message.message}`}</Text>;
              default:
                return null;
            }
          })}
        </Box>
      </Box>

      {showModelSelector ? (
        <Box marginTop={1}>
          <ModelSelector
            onSelect={handleModelSelect}
            onCancel={() => setShowModelSelector(false)}
          />
        </Box>
      ) : null}

      {!showModelSelector ? (
        <InputBox
          onSubmit={handleSubmit}
          isGenerating={isGenerating}
          onCancel={handleCancel}
          onApprove={() => handleApproval(true)}
          onDeny={() => handleApproval(false)}
          onRetry={handleRetry}
          pendingApproval={!!pendingApproval}
          canRetry={engineStatus === 'error'}
          workingDirectory={workingDirectory}
          phase={engineStatus}
          viewportWidth={termSize.cols}
        />
      ) : null}

      {showKeyboardBar ? (
        <KeyboardBar
          isGenerating={isGenerating}
          compact={compact}
          pendingApproval={!!pendingApproval}
          canRetry={engineStatus === 'error'}
        />
      ) : null}
      {showStatusBar ? (
        <StatusBar
          tokens={tokenUsage}
          status={statusText}
          engineStatus={engineStatus}
          compact={compact}
        />
      ) : null}
    </Box>
  );
};

function handleStreamEvent(
  event: StreamEvent,
  handlers: {
    runId: string;
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    setStatusText: React.Dispatch<React.SetStateAction<string>>;
    setTokenUsage: React.Dispatch<React.SetStateAction<{ prompt: number; completion: number } | undefined>>;
    setEngineStatus: React.Dispatch<React.SetStateAction<EngineStatus>>;
  },
) {
  const { runId, setMessages, setStatusText, setTokenUsage, setEngineStatus } = handlers;

  switch (event.type) {
    case 'status':
      setStatusText(event.message);
      break;

    case 'step-start':
      // No separate tracking needed — timeline nodes handle everything
      break;

    case 'reasoning':
      setMessages(previous => updateRunMessage(previous, runId, run => appendRunNode(run, {
        id: `${run.id}-thinking-${event.stepNumber}`,
        kind: 'thinking',
        label: `thinking`,
        detail: event.text,
        stepNumber: event.stepNumber,
        status: 'running',
      })));
      break;

    case 'tool-call-streaming-start':
      setMessages(previous => updateRunMessage(previous, runId, run => appendRunNode(run, {
        id: `${run.id}-tool-call-${event.toolCallId}`,
        kind: 'tool-call',
        label: event.toolName,
        detail: '',
        stepNumber: event.stepNumber,
        toolCallId: event.toolCallId,
        status: 'running',
      })));
      setStatusText(`Running ${event.toolName}`);
      break;

    case 'tool-call-delta':
      // Don't update UI on every delta — wait for full tool-call
      break;

    case 'tool-call':
      setMessages(previous => updateRunMessage(previous, runId, run => appendRunNode(run, {
        id: `${run.id}-tool-call-${event.toolCallId}`,
        kind: 'tool-call',
        label: event.toolName,
        detail: formatToolArgs(event.toolName, event.args ? JSON.stringify(event.args) : ''),
        stepNumber: event.stepNumber,
        toolCallId: event.toolCallId,
        status: 'running',
      })));
      setStatusText(`Running ${event.toolName}`);
      break;

    case 'tool-result':
      // Update tool-call node status, then add result node
      setMessages(previous => updateRunMessage(previous, runId, run => {
        const nodes = run.nodes.map(node => (
          node.kind === 'tool-call' && node.toolCallId === event.toolCallId
            ? { ...node, status: hasError(event.result) ? 'error' as const : 'done' as const }
            : node
        ));
        return appendRunNode({ ...run, nodes }, {
          id: `${run.id}-tool-result-${event.toolCallId}`,
          kind: 'tool-result',
          label: event.toolName,
          detail: formatToolResult(event.result),
          stepNumber: event.stepNumber,
          toolCallId: event.toolCallId,
          status: hasError(event.result) ? 'error' : 'done',
        });
      }));
      break;

    case 'step-finish':
      // No plan system to update — step transitions handled naturally
      break;

    case 'text-delta':
      setMessages(previous => updateRunMessage(previous, runId, run => appendRunNode(run, {
        id: `${run.id}-text-${event.stepNumber}`,
        kind: 'text',
        label: 'response',
        detail: event.text,
        stepNumber: event.stepNumber,
        status: 'running',
      })));
      break;

    case 'finish': {
      const stepLabel = `${event.totalSteps} step${event.totalSteps === 1 ? '' : 's'}`;
      const tokLabel = event.usage
        ? `${event.usage.promptTokens}+${event.usage.completionTokens} tok`
        : '';
      const doneDetail = [stepLabel, tokLabel].filter(Boolean).join(' · ');
      setMessages(previous => updateRunMessage(previous, runId, run => appendRunNode({
        ...run,
        status: 'complete',
        isStreaming: false,
      }, {
        id: `${run.id}-done`,
        kind: 'done',
        label: 'done',
        detail: doneDetail || undefined,
        status: 'done',
      })));
      setTokenUsage(
        event.usage
          ? { prompt: event.usage.promptTokens, completion: event.usage.completionTokens }
          : undefined,
      );
      setEngineStatus('complete');
      setStatusText(stepLabel);
      break;
    }

    case 'error':
      setEngineStatus('error');
      setMessages(previous => markRunErrored(previous, runId, event.error));
      break;
  }
}

// ═══════════════════════════════════════════════════
// RUN MESSAGE HELPERS
// ═══════════════════════════════════════════════════

function createRunMessage(id: string): Extract<ChatMessage, { type: 'run' }> {
  return {
    type: 'run',
    id,
    status: 'running',
    isStreaming: true,
    nodes: [],
  };
}

function markRunErrored(messages: ChatMessage[], runId: string, error: string) {
  return updateRunMessage(messages, runId, run => appendRunNode({
    ...run,
    status: 'error',
    isStreaming: false,
  }, {
    id: `${run.id}-error-${run.nodes.length}`,
    kind: 'phase',
    label: error,
    status: 'error',
  }));
}

function markRunCancelled(messages: ChatMessage[], runId: string | null) {
  if (!runId) {
    return messages;
  }

  return updateRunMessage(messages, runId, run => ({
    ...run,
    status: 'cancelled',
    isStreaming: false,
  }));
}

function updateRunMessage(
  messages: ChatMessage[],
  runId: string,
  updater: (run: Extract<ChatMessage, { type: 'run' }>) => Extract<ChatMessage, { type: 'run' }>,
) {
  return messages.map(message => {
    if (message.type !== 'run' || message.id !== runId) {
      return message;
    }

    return updater(message);
  });
}

function appendRunNode(
  run: Extract<ChatMessage, { type: 'run' }>,
  node: TimelineNodeView,
) {
  // Merge text/thinking deltas into existing node of same kind + step.
  // Search backward (not just last node) because smoothStream can delay
  // text-deltas past step-finish/done nodes.
  if (node.kind === 'thinking' || node.kind === 'text') {
    for (let i = run.nodes.length - 1; i >= Math.max(0, run.nodes.length - 6); i--) {
      const existing = run.nodes[i]!;
      if (existing.kind === node.kind && existing.stepNumber === node.stepNumber) {
        return {
          ...run,
          nodes: [
            ...run.nodes.slice(0, i),
            {
              ...existing,
              detail: (existing.detail || '') + (node.detail || ''),
              status: node.status ?? existing.status,
            },
            ...run.nodes.slice(i + 1),
          ],
        };
      }
    }
  }

  // Upsert tool-call nodes (same toolCallId)
  if (node.kind === 'tool-call') {
    const existingIndex = run.nodes.findIndex(existing => existing.kind === 'tool-call' && existing.toolCallId === node.toolCallId);
    if (existingIndex !== -1) {
      const nodes = [...run.nodes];
      const existing = nodes[existingIndex]!;
      nodes[existingIndex] = {
        ...existing,
        label: node.label,
        detail: node.detail || existing.detail,
        status: node.status ?? existing.status,
      };
      return { ...run, nodes };
    }
  }

  // Deduplicate identical phase nodes
  const lastNode = run.nodes[run.nodes.length - 1];
  if (node.kind === 'phase' && lastNode?.kind === 'phase' && lastNode.label === node.label) {
    return run;
  }

  return {
    ...run,
    nodes: [...run.nodes, node],
  };
}

// ═══════════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════════

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fitPath(pathname: string, limit: number) {
  const home = process.env.HOME || '';
  const shortened = home && pathname.startsWith(home) ? `~${pathname.slice(home.length)}` : pathname;
  if (shortened.length <= limit) {
    return shortened;
  }

  const parts = shortened.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return `${shortened.slice(0, Math.max(0, limit - 1))}…`;
  }

  const prefix = shortened.startsWith('~') ? '~' : '';
  const tail = parts.slice(-2).join('/');
  const compact = `${prefix}/…/${tail}`.replace('//', '/');
  if (compact.length <= limit) {
    return compact;
  }

  return `…${shortened.slice(-(limit - 1))}`;
}

function formatToolArgs(toolName: string, argsText: string): string {
  try {
    const args = JSON.parse(argsText);
    if (typeof args === 'object' && args !== null) {
      const entries = Object.entries(args);
      if (entries.length === 0) return `${toolName}()`;
      const parts = entries.map(([k, v]) => {
        const val = typeof v === 'string' ? (v.length > 40 ? `${v.slice(0, 37)}…` : v) : JSON.stringify(v);
        return `${k}: ${val}`;
      });
      return parts.join(', ');
    }
    return argsText;
  } catch {
    return argsText;
  }
}

function formatToolResult(result: unknown): string {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return formatToolResultObject(parsed);
    } catch {
      return result.length > 120 ? `${result.slice(0, 117)}…` : result;
    }
  }
  if (typeof result === 'object' && result !== null) {
    return formatToolResultObject(result);
  }
  return String(result).slice(0, 120);
}

function formatToolResultObject(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return String(obj).slice(0, 120);
  const record = obj as Record<string, unknown>;

  // Directory listing: { entries: [...] }
  if (record.entries && Array.isArray(record.entries)) {
    const names = record.entries.slice(0, 5).map((e: unknown) => {
      const entry = e as Record<string, unknown>;
      return entry.name || entry.path || '?';
    });
    const suffix = record.entries.length > 5 ? ` +${record.entries.length - 5} more` : '';
    return `${record.entries.length} items: ${names.join(', ')}${suffix}`;
  }

  // Success result: { success: true, path: "..." }
  if (record.success === true) {
    if (record.path) return String(record.path);
    if (record.output && typeof record.output === 'string') {
      return record.output.length > 120 ? `${record.output.slice(0, 117)}…` : record.output;
    }
    return 'ok';
  }

  // Error result
  if (record.error) {
    return `error: ${String(record.error).slice(0, 100)}`;
  }

  // File content
  if (record.content && typeof record.content === 'string') {
    return record.content.length > 120 ? `${record.content.slice(0, 117)}…` : record.content;
  }
  if (record.output && typeof record.output === 'string') {
    return record.output.length > 120 ? `${record.output.slice(0, 117)}…` : record.output;
  }

  const json = JSON.stringify(obj);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

function hasError(result: unknown) {
  return typeof result === 'object' && result !== null && 'error' in result && Boolean((result as { error?: unknown }).error);
}

export default App;
