import React, { useState, useEffect, type FC } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons } from '../theme/theme.js';
import { Spinner, Panel } from '../components/components.js';
import {
  getProviders,
  fetchModelsFromProvider,
  cacheModels,
  getCachedModels,
  setSetting,
  updateProviderKey,
  type ProviderConfig,
  type ModelInfo,
} from '../../core/providers/registry.js';

interface ModelSelectorProps {
  onSelect: (providerId: string, modelId: string) => void;
  onCancel: () => void;
}

type Phase = 'provider' | 'model' | 'apikey';

export const ModelSelector: FC<ModelSelectorProps> = ({ onSelect, onCancel }) => {
  const [phase, setPhase] = useState<Phase>('provider');
  const [providerList, setProviderList] = useState<ProviderConfig[]>([]);
  const [selProvider, setSelProvider] = useState<ProviderConfig | null>(null);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setProviderList(getProviders()); }, []);

  async function loadModels(provider: ProviderConfig) {
    setLoading(true);
    setError('');
    setPhase('model');
    setIdx(0);

    if (provider.type !== 'ollama' && !provider.apiKey && !process.env[`${provider.type.toUpperCase()}_API_KEY`]) {
      setPhase('apikey');
      setLoading(false);
      return;
    }

    try {
      const fetched = await fetchModelsFromProvider(provider);
      if (fetched.length > 0) {
        cacheModels(fetched);
        setModelList(fetched);
      } else {
        const cached = getCachedModels(provider.id);
        setModelList(cached);
        if (cached.length === 0) setError('No models found. Check key/connection.');
      }
    } catch (e: any) {
      setError(e.message);
      setModelList(getCachedModels(provider.id));
    }
    setLoading(false);
  }

  useInput((ch, key) => {
    if (key.escape) {
      if (phase === 'model') { setPhase('provider'); setIdx(0); return; }
      if (phase === 'apikey') { setPhase('provider'); setIdx(0); return; }
      onCancel();
      return;
    }

    if (phase === 'apikey') {
      if (key.return && apiKey.trim() && selProvider) {
        updateProviderKey(selProvider.id, apiKey.trim());
        selProvider.apiKey = apiKey.trim();
        setApiKey('');
        loadModels(selProvider);
      } else if (key.backspace || key.delete) {
        setApiKey(p => p.slice(0, -1));
      } else if (ch && !key.ctrl && !key.meta) {
        setApiKey(p => p + ch);
      }
      return;
    }

    const max = phase === 'provider' ? providerList.length - 1 : modelList.length - 1;
    if (key.upArrow) setIdx(i => Math.max(0, i - 1));
    else if (key.downArrow) setIdx(i => Math.min(max, i + 1));
    else if (key.return) {
      if (phase === 'provider') {
        const p = providerList[idx];
        if (p) { setSelProvider(p); loadModels(p); }
      } else if (phase === 'model') {
        const m = modelList[idx];
        if (m && selProvider) {
          setSetting('active_provider', selProvider.id);
          setSetting('active_model', m.modelId);
          onSelect(selProvider.id, m.modelId);
        }
      }
    }
  });

  // API Key entry
  if (phase === 'apikey' && selProvider) {
    return (
      <Panel title={`${icons.friday} API Key — ${selProvider.name}`} borderColor={colors.amber}>
        <Box flexDirection="column">
          <Text color={colors.dim}>Enter your {selProvider.name} API key:</Text>
          <Box marginTop={1}>
            <Text color={colors.cyan}>{icons.prompt} </Text>
            <Text color={colors.text}>{apiKey ? '•'.repeat(apiKey.length) : ''}<Text color={colors.brand}>▎</Text></Text>
          </Box>
          <Text color={colors.dim}>Enter confirm · Esc back</Text>
        </Box>
      </Panel>
    );
  }

  // Provider list
  if (phase === 'provider') {
    return (
      <Panel title={`${icons.friday} Select Provider`} borderColor={colors.brand}>
        <Box flexDirection="column">
          {providerList.map((p, i) => {
            const sel = i === idx;
            const line = `${sel ? '▸ ' : '  '}${p.name} (${p.type})${p.apiKey ? ' ✓' : ''}`;
            return (
              <Text key={p.id} color={sel ? colors.brand : colors.dim} bold={sel}>{line}</Text>
            );
          })}
          <Text color={colors.dim}>↑↓ navigate · Enter select · Esc cancel</Text>
        </Box>
      </Panel>
    );
  }

  // Model list
  return (
    <Panel title={`${icons.friday} Select Model — ${selProvider?.name || ''}`} borderColor={colors.brand}>
      <Box flexDirection="column">
        {loading && <Spinner label="Fetching models..." />}
        {error && <Text color={colors.red}>{icons.fail} {error}</Text>}
        {!loading && modelList.map((m, i) => {
          const sel = i === idx;
          const suffix = `${m.supportsReasoning ? ' 🧠' : ''}${m.contextWindow ? ` ${Math.round(m.contextWindow / 1000)}K` : ''}`;
          const line = `${sel ? '▸ ' : '  '}${m.name}${suffix}`;
          return (
            <Text key={m.id} color={sel ? colors.brand : colors.dim} bold={sel}>{line}</Text>
          );
        })}
        {!loading && <Text color={colors.dim}>↑↓ navigate · Enter select · Esc back</Text>}
      </Box>
    </Panel>
  );
};
