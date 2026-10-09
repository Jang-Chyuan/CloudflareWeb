import React, { useState } from 'react';
import { supabase, supabaseConfigError } from '../lib/supabaseClient';

export default function Login({ authError }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function login(event) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError('登入失敗，請確認 Email、密碼與網路連線。');
      else setPassword('');
    } catch { setError('無法連線，請稍後再試。'); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-intro"><div className="brand"><span className="brand-paw">🐾</span> DogTracker</div>
      <span className="eyebrow">SLAVE TRACKING</span><h1>隨時掌握，<br />每一隻狗的位置。</h1>
      <p>查看犬隻位置、移動軌跡與項圈狀態。</p>
      <div className="login-features"><span>◎ 即時地圖</span><span>↝ 歷史軌跡</span><span>▥ 活動紀錄</span></div>
    </div>
    <section className="login-card"><span className="eyebrow">歡迎回來</span><h2>登入 DogTracker</h2>
      <p>使用 DogTracker App 相同的雲端帳號。</p>
      <form onSubmit={login}>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy || !supabase} placeholder="you@example.com" /></label>
        <label>密碼<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy || !supabase} placeholder="輸入帳號密碼" /></label>
        {(error || authError || supabaseConfigError) && <p className="error" role="alert">{error || authError || supabaseConfigError}</p>}
        <button className="primary" disabled={busy || !supabase}>{busy ? '登入中…' : '登入'}</button>
      </form><p className="login-note">僅顯示此帳號已授權的犬隻資料。</p>
    </section>
  </div>;
}
