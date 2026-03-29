import React, { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { Box, Text, useApp, useStdout } from 'ink';
import { colors, icons } from '../theme/theme.js';
import {
  StatusBar,
  WelcomeScreen,
  MessageBubble,
  ToolCallBlock,
  ThinkingBlock,
  HelpView,
  Toast,
  Divider,
  Spinner,
} from '../components/components.js';
import { InputBox } from './InputBox.js';
import { ModelSelector } from './ModelSelector.js';
import { AgentEngine, type StreamEvent } from '../../core/engine/agent.js';
import { getSetting, setSetting } from '../../core/providers/registry.js';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

// Message types for the chat history
type ChatMessage =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; reasoning?: string; isStreaming?: boolean }
  | { type: 'tool-call'; toolName: string; args?: unknown; result?: unknown; isRunning?: boolean }
  | { type: 'thinking'; text: string; isStreaming?: boolean }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'divider'; label?: string }
  | { type: 'help' }
  | { type: 'toast'; message: string; toastType: 'info' | 'success' | 'error' | 'warning' };

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
  const [showWelcome, setShowWelcome] = useState(true);
  const [termSize, setTermSize] = useState({ cols: stdout?.columns || 80, rows: stdout?.rows || 24 });

  const engineRef = useRef<AgentEngine | null>(null);

  // Track terminal size
  useEffect(() => {
    const onResize = () => {
      if (stdout) setTermSize({ cols: stdout.columns, rows: stdout.rows });
    };
    stdout?.on('resize', onResize);
    return () => { stdout?.off('resize', onResize); };
  }, [stdout]);

  // Initialize engine
  useEffect(() => {
    engineRef.current = new AgentEngine({
      workingDirectory,
    });
    engineRef.current.ensureConversation();
  }, []);

  // Handle slash commands
  const handleCommand = useCallback((input: string): boolean => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case '/help':
        setMessages(prev => [...prev, { type: 'help' }]);
        return true;

      case '/model':
        setShowModelSelector(true);
        return true;

      case '/provider':
        setShowModelSelector(true);
        return true;

      case '/clear':
        setMessages([]);
        engineRef.current?.clearHistory();
        setShowWelcome(true);
        setMessages(prev => [...prev, {
          type: 'toast',
          message: 'Conversation cleared',
          toastType: 'success',
        }]);
        return true;

      case '/scope': {
        const newPath = parts[1];
        if (!newPath) {
          setMessages(prev => [...prev, {
            type: 'toast',
            message: `Current scope: ${workingDirectory}`,
            toastType: 'info',
          }]);
          return true;
        }
        const resolved = resolve(workingDirectory, newPath);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
          setWorkingDirectory(resolved);
          engineRef.current?.setWorkingDirectory(resolved);
          setMessages(prev => [...prev, {
            type: 'toast',
            message: `Scope changed to: ${resolved}`,
            toastType: 'success',
          }]);
        } else {
          setMessages(prev => [...prev, {
            type: 'toast',
            message: `Directory not found: ${resolved}`,
            toastType: 'error',
          }]);
        }
        return true;
      }

      case '/history':
        setMessages(prev => [...prev, {
          type: 'toast',
          message: `${engineRef.current?.getMessageCount() || 0} messages in history`,
          toastType: 'info',
        }]);
        return true;

      case '/new':
        setMessages([]);
        engineRef.current?.clearHistory();
        engineRef.current?.ensureConversation();
        setShowWelcome(true);
        setTokenUsage(undefined);
        return true;

      case '/exit':
        exit();
        return true;

      default:
        return false;
    }
  }, [workingDirectory, exit]);

  // Handle user message submission
  const handleSubmit = useCallback(async (input: string) => {
    if (showWelcome) setShowWelcome(false);

    // Check for slash commands
    if (input.startsWith('/')) {
      if (handleCommand(input)) return;
    }

    if (!engineRef.current) return;

    setIsGenerating(true);
    setStatusText('Generating...');

    // Add user message
    setMessages(prev => [...prev, { type: 'user', content: input }]);

    // Add placeholder for assistant response
    const assistantIdx = { current: -1 };

    setMessages(prev => {
      assistantIdx.current = prev.length;
      return [...prev, { type: 'assistant', content: '', isStreaming: true }];
    });

    try {
      for await (const event of engineRef.current.run(input)) {
        switch (event.type) {
          case 'text-delta':
            setMessages(prev => {
              const updated = [...prev];
              const lastAssistant = findLastAssistant(updated);
              if (lastAssistant >= 0) {
                const msg = updated[lastAssistant] as Extract<ChatMessage, { type: 'assistant' }>;
                updated[lastAssistant] = { ...msg, content: msg.content + event.text };
              }
              return updated;
            });
            break;

          case 'reasoning':
            setMessages(prev => {
              const updated = [...prev];
              // Find or create thinking block before the last assistant message
              const lastAssistant = findLastAssistant(updated);
              const thinkingIdx = findLastThinking(updated);

              if (thinkingIdx >= 0 && thinkingIdx > findLastUser(updated)) {
                const msg = updated[thinkingIdx] as Extract<ChatMessage, { type: 'thinking' }>;
                updated[thinkingIdx] = { ...msg, text: msg.text + event.text, isStreaming: true };
              } else {
                // Insert thinking before the assistant message
                const insertAt = lastAssistant >= 0 ? lastAssistant : updated.length;
                updated.splice(insertAt, 0, { type: 'thinking', text: event.text, isStreaming: true });
              }
              return updated;
            });
            break;

          case 'tool-call-start':
            setMessages(prev => [...prev, {
              type: 'tool-call',
              toolName: event.toolName,
              args: event.args,
              isRunning: true,
            }]);
            setStatusText(`Running ${event.toolName}...`);
            break;

          case 'tool-result':
            setMessages(prev => {
              const updated = [...prev];
              // Find the running tool call and update it
              for (let i = updated.length - 1; i >= 0; i--) {
                const msg = updated[i];
                if (msg?.type === 'tool-call' && msg.toolName === event.toolName && msg.isRunning) {
                  updated[i] = { ...msg, result: event.result, isRunning: false };
                  break;
                }
              }
              return updated;
            });
            setStatusText('Generating...');
            break;

          case 'finish':
            setMessages(prev => {
              const updated = [...prev];
              // Mark assistant message as done streaming
              const lastAssistant = findLastAssistant(updated);
              if (lastAssistant >= 0) {
                const msg = updated[lastAssistant] as Extract<ChatMessage, { type: 'assistant' }>;
                updated[lastAssistant] = { ...msg, isStreaming: false };
              }
              // Mark thinking as done
              const lastThinking = findLastThinking(updated);
              if (lastThinking >= 0) {
                const msg = updated[lastThinking] as Extract<ChatMessage, { type: 'thinking' }>;
                updated[lastThinking] = { ...msg, isStreaming: false };
              }
              return updated;
            });
            if (event.usage) {
              setTokenUsage({ prompt: event.usage.promptTokens, completion: event.usage.completionTokens });
            }
            break;

          case 'error':
            setMessages(prev => [...prev, { type: 'error', message: event.error }]);
            break;

          case 'status':
            setStatusText(event.message);
            break;
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { type: 'error', message: e.message || 'Unknown error' }]);
    } finally {
      setIsGenerating(false);
      setStatusText('');
    }
  }, [showWelcome, handleCommand]);

  // Cancel generation
  const handleCancel = useCallback(() => {
    engineRef.current?.abort();
    setIsGenerating(false);
    setStatusText('');
    setMessages(prev => [...prev, {
      type: 'toast',
      message: 'Generation cancelled',
      toastType: 'warning',
    }]);
  }, []);

  // Model selector callbacks
  const handleModelSelect = useCallback((providerId: string, modelId: string) => {
    setActiveProvider(providerId);
    setActiveModel(modelId);
    setShowModelSelector(false);
    setMessages(prev => [...prev, {
      type: 'toast',
      message: `Model set to ${providerId}/${modelId}`,
      toastType: 'success',
    }]);
  }, []);

  // Render - only show visible messages (tail) for performance
  const visibleMessages = messages.length > 50 ? messages.slice(-50) : messages;

  return (
    <Box flexDirection="column" width={termSize.cols}>
      {/* Chat messages area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {showWelcome && !messages.some(m => m.type === 'user') && (
          <WelcomeScreen
            model={activeModel}
            provider={activeProvider}
            scope={shortenPath(workingDirectory)}
          />
        )}

        {visibleMessages.map((msg, i) => {
          switch (msg.type) {
            case 'user':
              return <MessageBubble key={i} role="user" content={msg.content} />;
            case 'assistant':
              return (
                <MessageBubble
                  key={i}
                  role="assistant"
                  content={msg.content}
                  isStreaming={msg.isStreaming}
                />
              );
            case 'thinking':
              return <ThinkingBlock key={i} text={msg.text} isStreaming={msg.isStreaming} />;
            case 'tool-call':
              return (
                <ToolCallBlock
                  key={i}
                  toolName={msg.toolName}
                  args={msg.args}
                  result={msg.result}
                  isRunning={msg.isRunning}
                />
              );
            case 'help':
              return <HelpView key={i} />;
            case 'toast':
              return <Toast key={i} message={msg.message} type={msg.toastType} />;
            case 'error':
              return (
                <Box key={i} paddingX={2}>
                  <Text color={colors.red}>
                    {icons.fail} {msg.message}
                  </Text>
                </Box>
              );
            case 'status':
              return (
                <Box key={i} paddingX={2}>
                  <Text color={colors.dim}>{msg.message}</Text>
                </Box>
              );
            case 'divider':
              return <Divider key={i} label={msg.label} />;
            default:
              return null;
          }
        })}
      </Box>

      {/* Model selector overlay */}
      {showModelSelector && (
        <ModelSelector
          onSelect={handleModelSelect}
          onCancel={() => setShowModelSelector(false)}
        />
      )}

      {/* Input area */}
      {!showModelSelector && (
        <InputBox
          onSubmit={handleSubmit}
          isGenerating={isGenerating}
          onCancel={handleCancel}
          workingDirectory={workingDirectory}
        />
      )}

      {/* Status bar */}
      <StatusBar
        model={activeModel || 'none'}
        provider={activeProvider}
        scope={shortenPath(workingDirectory)}
        tokens={tokenUsage}
        status={statusText}
      />
    </Box>
  );
};

// Helper functions
function findLastAssistant(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'assistant') return i;
  }
  return -1;
}

function findLastThinking(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'thinking') return i;
  }
  return -1;
}

function findLastUser(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'user') return i;
  }
  return -1;
}

function shortenPath(p: string): string {
  const home = process.env.HOME || '';
  if (home && p.startsWith(home)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

export default App;
