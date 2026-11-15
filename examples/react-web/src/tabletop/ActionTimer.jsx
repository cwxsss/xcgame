import React, { useEffect, useState } from 'react';

export function ActionTimer({
  clock,
  actionSeconds,
  isHost,
  canAct,
  setActionSeconds,
}) {
  const [duration, setDuration] = useState(String(actionSeconds ?? 60));
  const [now, setNow] = useState(Date.now);
  const endsAt = clock?.endsAt;
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) window.clearInterval(interval);
    }, 200);
    return () => window.clearInterval(interval);
  }, [endsAt]);
  useEffect(() => setDuration(String(actionSeconds ?? 60)), [actionSeconds]);

  if (!isHost && !clock) return null;
  const remaining = endsAt ? Math.max(0, endsAt - now) : 0;
  const seconds = Math.min(actionSeconds ?? 60, Math.ceil(remaining / 1000));
  const display = [Math.floor(seconds / 60), seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');

  return (
    <section className="tabletop-card avalon-timer" aria-label="操作倒计时">
      <div>
        <h2>操作倒计时</h2>
        {clock ? (
          <>
            <p>{clock.label}</p>
            <strong className="avalon-clock">{display}</strong>
            <span role="status">
              {remaining > 0 ? '等待你的操作' : '时间到，可以继续操作'}
            </span>
          </>
        ) : (
          <span>等待你的下一步操作</span>
        )}
      </div>
      {isHost && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canAct) setActionSeconds(Number(duration));
          }}
        >
          <label>
            每步用时（秒）
            <input
              type="number"
              min="1"
              max="3600"
              step="1"
              required
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <div className="tabletop-actions">
            <button
              type="submit"
              disabled={!canAct || Number(duration) === actionSeconds}
            >
              保存用时
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
