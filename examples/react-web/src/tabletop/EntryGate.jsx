import React, { useCallback, useEffect, useRef, useState } from 'react';
import './entry.css';

const ACCESS_ENDPOINT = '/access';

function getRetryAfter(response) {
  const value = Number.parseInt(response.headers.get('Retry-After') || '', 10);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

async function readResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function EntryGate({ children }) {
  const [status, setStatus] = useState('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const passwordInputRef = useRef(null);

  const checkAccess = useCallback(async (signal) => {
    setStatus('checking');
    setError('');

    try {
      const response = await fetch(ACCESS_ENDPOINT, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
      });
      const result = await readResponse(response);

      if (!response.ok) {
        throw new Error(result.message || 'access-check-failed');
      }

      setStatus(result.allowed ? 'allowed' : 'locked');
      if (result.allowed) {
        setPassword('');
      }
    } catch (requestError) {
      if (requestError.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError('暂时无法连接游戏厅，请检查网络后重试。');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkAccess(controller.signal);
    return () => controller.abort();
  }, [checkAccess]);

  useEffect(() => {
    if (retryAfter <= 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setRetryAfter((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || retryAfter > 0 || !password) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(ACCESS_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      const result = await readResponse(response);

      if (response.ok && result.allowed) {
        setPassword('');
        setStatus('allowed');
        return;
      }

      if (response.status === 429) {
        const seconds = getRetryAfter(response);
        setRetryAfter(seconds);
        setError(`尝试次数过多，请在 ${seconds} 秒后再试。`);
      } else if (response.status === 401) {
        setPassword('');
        setError('密码不正确，请重试。');
        window.setTimeout(() => passwordInputRef.current?.focus(), 0);
      } else {
        setError('验证暂时不可用，请稍后重试。');
      }
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError('暂时无法连接游戏厅，请检查网络后重试。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'allowed') {
    return children;
  }

  if (status === 'checking') {
    return (
      <main className="entry-gate" aria-busy="true" aria-live="polite">
        <section className="entry-gate__card entry-gate__card--checking">
          <div className="entry-gate__mark" aria-hidden="true">
            ♜
          </div>
          <p className="entry-gate__eyebrow">小褚游戏厅</p>
          <h1>正在打开游戏厅</h1>
          <p className="entry-gate__hint">正在检查访问权限，请稍候。</p>
        </section>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="entry-gate">
        <section className="entry-gate__card" role="alert">
          <div className="entry-gate__mark" aria-hidden="true">
            ♜
          </div>
          <p className="entry-gate__eyebrow">小褚游戏厅</p>
          <h1>暂时无法打开游戏厅</h1>
          <p className="entry-gate__hint">{error}</p>
          <button
            className="entry-gate__button"
            type="button"
            onClick={() => checkAccess()}
          >
            重新检查
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="entry-gate">
      <section className="entry-gate__card">
        <div className="entry-gate__mark" aria-hidden="true">
          ♜
        </div>
        <p className="entry-gate__eyebrow">小褚游戏厅</p>
        <h1>进入游戏厅</h1>
        <p className="entry-gate__hint">
          这是私人游戏厅，请输入访问密码。验证成功后，本设备会保持登录状态。
        </p>
        <form className="entry-gate__form" onSubmit={handleSubmit}>
          <label htmlFor="entry-gate-password">访问密码</label>
          <input
            ref={passwordInputRef}
            id="entry-gate-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) {
                setError('');
              }
            }}
            placeholder="请输入访问密码"
            aria-describedby={error ? 'entry-gate-message' : undefined}
            disabled={submitting || retryAfter > 0}
          />
          <button
            className="entry-gate__button"
            type="submit"
            disabled={submitting || retryAfter > 0 || !password}
          >
            {submitting
              ? '验证中…'
              : retryAfter > 0
                ? `请等待 ${retryAfter} 秒`
                : '进入游戏厅'}
          </button>
        </form>
        {error && (
          <p id="entry-gate-message" className="entry-gate__error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
