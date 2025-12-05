import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './pages/Login';
import Upload from './pages/Upload';
import Navbar from './components/Navbar';
import './app.css';

const VITE_APP_GOOGLE_CLIENT_ID = import.meta.env.VITE_APP_GOOGLE_CLIENT_ID;
const VITE_APP_API_URL = import.meta.env.VITE_APP_API_URL;

function AppContent({ user, handleLogout, theme, setTheme }) {
  return (
    <div className="w-full h-full flex flex-col">
      <Navbar onLogout={handleLogout} user={user} theme={theme} onThemeChange={setTheme} />
      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Upload user={user} />} />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);

  // Theme state - no localStorage, defaults to light on each session
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('theme-dark');
    } else {
      root.classList.remove('theme-dark');
    }
  }, [theme]);

  useEffect(() => {
    const stored = localStorage.getItem('br_user');
    if (stored) {
      const { data, expiry } = JSON.parse(stored);
      if (expiry > Date.now()) setUser(data);
      else localStorage.removeItem('br_user');
    }
  }, []);

  const handleLoginSuccess = (userData) => {
    const item = { data: userData, expiry: Date.now() + (60 * 60 * 1000) };
    localStorage.setItem('br_user', JSON.stringify(item));
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('br_user');
    try { window.history.replaceState({}, '', '/'); } catch { }
  };

  if (!user) {
    return (
      <GoogleOAuthProvider clientId={VITE_APP_GOOGLE_CLIENT_ID}>
        <Router>
          <Routes>
            <Route path="*" element={<Login onLoginSuccess={handleLoginSuccess} />} />
          </Routes>
        </Router>
      </GoogleOAuthProvider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={VITE_APP_GOOGLE_CLIENT_ID}>
      <Router>
        <AppContent
          user={user}
          handleLogout={handleLogout}
          theme={theme}
          setTheme={setTheme}
        />
      </Router>
    </GoogleOAuthProvider>
  );
}

export default App;