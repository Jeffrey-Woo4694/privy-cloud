// Composer model/effort picker for the Hermes Agent tab. Opens from a badge in
// the composer; on open it fetches `model.options` (explicit_only) + `config.get
// reasoning`, renders one section per provider (models) and a row of effort
// chips, and applies changes via the `setModel` / `setEffort` bridge actions.
//
// A model switch that requires confirmation (`config.set` returns
// `confirm_required`) shows a confirm banner and re-issues with
// `confirm_expensive_model: true` — mirroring Native-Hermes.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { EFFORT_LEVELS } from '../hermes/types';

export interface ProviderOption {
  slug: string;
  models: string[];
  authenticated?: boolean;
  is_current?: boolean;
  is_user_defined?: boolean;
}

/// Decode a `model.options` response into provider rows. Mirrors Native-Hermes
/// `settings.rs` `parse_model_options`.
export function parseProviderOptions(result: unknown): { currentModel?: string; currentProvider?: string; providers: ProviderOption[] } {
  const r = (result ?? {}) as {
    current_model?: string;
    current_provider?: string;
    providers?: Array<Record<string, unknown>>;
  };
  const providers = (r.providers ?? [])
    .map((p) => ({
      slug: String(p?.slug ?? ''),
      models: (Array.isArray(p?.models) ? p.models : []).map(String),
      authenticated: typeof p?.authenticated === 'boolean' ? p.authenticated : undefined,
      is_current: typeof p?.is_current === 'boolean' ? p.is_current : undefined,
      is_user_defined: typeof p?.is_user_defined === 'boolean' ? p.is_user_defined : undefined,
    }))
    .filter((p) => p.slug && p.models.length);
  return { currentModel: r.current_model, currentProvider: r.current_provider, providers };
}

export function HermesModelPicker({
  sessionId,
  currentModel,
  currentProvider,
  currentEffort,
  setModel,
  setEffort,
  onClose,
}: {
  sessionId?: string;
  currentModel?: string;
  currentProvider?: string;
  currentEffort?: string;
  setModel: (providerSlug: string, model: string, scope?: 'session' | 'global', confirmExpensive?: boolean) => Promise<unknown>;
  setEffort: (level: string) => Promise<void>;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ slug: string; model: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.hermesCall('model.options', { explicit_only: true }),
      api.hermesCall('config.get', { key: 'reasoning', session_id: sessionId }),
    ])
      .then(([opts]) => {
        if (cancelled) return;
        setProviders(parseProviderOptions(opts).providers);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load models.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const pick = async (slug: string, model: string) => {
    setConfirm(null);
    setError('');
    try {
      const res = (await setModel(slug, model)) as { confirm_required?: boolean; confirm_message?: string } | undefined;
      if (res?.confirm_required) {
        setConfirm({ slug, model, message: res.confirm_message ?? 'This model may cost more. Switch anyway?' });
        return;
      }
      onClose();
    } catch {
      setError('Model switch failed.');
    }
  };

  const confirmPick = async () => {
    if (!confirm) return;
    setConfirm(null);
    setError('');
    try {
      await setModel(confirm.slug, confirm.model, 'session', true);
      onClose();
    } catch {
      setError('Model switch failed.');
    }
  };

  return (
    <div className="model-popover">
      <div className="model-popover-title">Model</div>
      {loading && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--danger, #f87171)', fontSize: 12 }}>{error}</div>}
      {providers.map((p) => (
        <div key={p.slug} className="model-provider">
          <div className="model-provider-name">{p.slug}</div>
          {p.models.map((m) => {
            const active = m === currentModel && p.slug === currentProvider;
            return (
              <button
                key={m}
                className="btn"
                onClick={() => pick(p.slug, m)}
                aria-pressed={active}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  ...(active ? { background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 } : {}),
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
      ))}
      <div className="model-efforts">
        <span className="model-popover-title">Effort</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {EFFORT_LEVELS.map((lvl) => (
            <button
              key={lvl}
              className="btn"
              onClick={() => { setEffort(lvl); onClose(); }}
              aria-pressed={lvl === currentEffort}
              style={lvl === currentEffort ? { background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 } : undefined}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>
      {confirm && (
        <div className="model-confirm">
          <div style={{ marginBottom: 6 }}>{confirm.message}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn primary" onClick={confirmPick}>Confirm</button>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
