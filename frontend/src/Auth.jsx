import { useState } from 'react';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'leadrouter2024';

export function useAuth() {
  const stored = sessionStorage.getItem('lr_auth');
  const [authed, setAuthed] = useState(stored === 'yes');
  function login(pass) {
    if (pass === ADMIN_PASSWORD) { sessionStorage.setItem('lr_auth', 'yes'); setAuthed(true); return true; }
    return false;
  }
  function logout() { sessionStorage.removeItem('lr_auth'); setAuthed(false); }
  return { authed, login, logout };
}

export function LoginPage({ onLogin }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);
  function handleSubmit(e) { e.preventDefault(); if (!onLogin(pass)) setError(true); }
  return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:'40px 48px', width:360, textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:8 }}>🎯</div>
        <h1 style={{ fontSize:20, fontWeight:600, marginBottom:4, color:'var(--text)' }}>Lead Router</h1>
        <p style={{ fontSize:13, color:'var(--text3)', marginBottom:28 }}>Введи пароль для доступа</p>
        <form onSubmit={handleSubmit}>
          <input className="input" type="password" placeholder="Пароль" value={pass} onChange={e => { setPass(e.target.value); setError(false); }} style={{ marginBottom:12, textAlign:'center', letterSpacing:2 }} autoFocus />
          {error && <p style={{ fontSize:12, color:'var(--red)', marginBottom:12 }}>Неверный пароль</p>}
          <button className="btn btn-primary" type="submit" style={{ width:'100%', justifyContent:'center' }}>Войти</button>
        </form>
      </div>
    </div>
  );
}
