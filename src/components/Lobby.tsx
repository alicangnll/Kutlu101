import React, { useState, useEffect } from 'react';
import './Lobby.css';
import { type RoomSettings } from '../types';

interface LobbyProps {
  onJoin: (username: string, roomId: string) => void;
  onCreate: (username: string, roomId: string, settings: RoomSettings) => void;
  error: string | null;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin, onCreate, error }) => {
  const [activeTab, setActiveTab] = useState<'join' | 'create'>('join');
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  
  const [isKatlamali, setIsKatlamali] = useState(false);
  const [maxScore, setMaxScore] = useState(800);
  const [islekCezasi, setIslekCezasi] = useState(true);  // Klasik 101 Okey: varsayılan açık
  const [okeyCezasi, setOkeyCezasi] = useState(true);    // Klasik 101 Okey: varsayılan açık
  
  const [isInvite, setIsInvite] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomId(roomParam);
      setActiveTab('join');
      setIsInvite(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && roomId.trim()) {
      if (activeTab === 'join') {
        onJoin(username.trim(), roomId.trim());
      } else {
        onCreate(username.trim(), roomId.trim(), {
          isKatlamali,
          maxScore,
          islekCezasi,
          okeyCezasi
        });
      }
    }
  };

  return (
    <div className="lobby-container">
      <div className="lobby-card" style={{ maxWidth: '400px' }}>
        <h1>101 KUTLU</h1>
        
        {!isInvite && (
          <div className="lobby-tabs">
            <button 
              className={`tab-btn ${activeTab === 'join' ? 'active' : ''}`} 
              onClick={() => setActiveTab('join')}
            >
              Odaya Katıl
            </button>
            <button 
              className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`} 
              onClick={() => setActiveTab('create')}
            >
              Oda Kur
            </button>
          </div>
        )}

        {isInvite && (
          <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Davetli Odaya Katıl</h2>
        )}

        <form onSubmit={handleSubmit} className="lobby-form" style={{ marginTop: '20px' }}>
          <input
            type="text"
            placeholder="Kullanıcı Adı"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={12}
            required
          />
          {!isInvite && (
            <input
              type="text"
              placeholder="Oda Kodu (örn: 1453)"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              maxLength={8}
              required
            />
          )}

          {activeTab === 'create' && (
            <div className="settings-panel">
              <label className="settings-row">
                <input type="checkbox" checked={isKatlamali} onChange={(e) => setIsKatlamali(e.target.checked)} />
                Katlamalı Mod
              </label>
              <label className="settings-row">
                <input type="checkbox" checked={islekCezasi} onChange={(e) => setIslekCezasi(e.target.checked)} />
                İşlek Atma Cezası
              </label>
              <label className="settings-row">
                <input type="checkbox" checked={okeyCezasi} onChange={(e) => setOkeyCezasi(e.target.checked)} />
                Yere Okey Atma Cezası
              </label>
              <label className="settings-row">
                Bitiş Puanı (Max):
                <select value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} style={{ marginLeft: '10px' }}>
                  {[200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <button type="submit" style={{ marginTop: '15px' }}>
            {activeTab === 'join' ? 'Odaya Katıl' : 'Oda Kur'}
          </button>
        </form>
        {error && <p className="lobby-error">{error}</p>}
      </div>
    </div>
  );
};
