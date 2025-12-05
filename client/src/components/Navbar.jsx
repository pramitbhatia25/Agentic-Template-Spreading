import React, { useState, useRef, useEffect } from 'react';
import { LogOut, User } from 'lucide-react';

function Navbar({ onLogout, user, theme, onThemeChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userInfo = user?.user || user;
  const userName = userInfo?.name || userInfo?.email?.split('@')[0] || 'User';
  const userAvatar = userInfo?.picture || userInfo?.avatar;

  return (
    <nav className="w-full bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center">
        <h1 className="text-xl font-bold text-gray-900">PDF Extraction Tool</h1>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {userAvatar ? (
              <img
                src={userAvatar}
                alt={userName}
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            )}
            <span className="text-sm font-medium text-gray-700">{userName}</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
