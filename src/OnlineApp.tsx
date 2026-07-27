import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';
import type { GameState, TileData, RackSlot } from './types';
import { calculateRackPoints } from './utils/ruleEngine';
import { autoSortSeries, autoSortPairs } from './utils/sortLogic';
import { Rack } from './components/Rack';
import { DiscardArea } from './components/DiscardArea';
import { TableMeldGroup } from './components/TableMeldGroup';
import { Lobby } from './components/Lobby';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Tile } from './components/Tile';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://kutlu101.onrender.com';

const Opponent: React.FC<{ position: string, name: string, tileCount: number, discard: string, isActive?: boolean }> = ({ position, name, tileCount: _tileCount, discard: _discard, isActive }) => {
  return (
    <div className={`opponent-${position} ${isActive ? 'active-turn' : ''}`}>
      <div className="flex-center" style={{ gap: '4px' }}>
        <div className="avatar">
          <div className="avatar-icon">👤</div>
          <div>{name}</div>
        </div>
      </div>
    </div>
  );
};

export default function OnlineApp() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [_username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<{username: string, gamePlayerId: string, isBot?: boolean}[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myGamePlayerId, setMyGamePlayerId] = useState<string | null>(null);
  const [activeTile, setActiveTile] = useState<TileData | null>(null);
  const [gameFinishedInfo, setGameFinishedInfo] = useState<{winner: string | null, okeyFinish?: boolean, reason?: string, isGameEnded?: boolean} | null>(null);
  
  const [timeLeft, setTimeLeft] = useState(30);
  const [voteState, setVoteState] = useState<{active: boolean, yes: number, no: number, startTime: number} | null>(null);
  const [voteTimeLeft, setVoteTimeLeft] = useState(30);
  const [myVote, setMyVote] = useState<'yes' | 'no' | null>(null);
  const [isSorting, setIsSorting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('roomUpdate', (players) => {
      setRoomPlayers(players);
      const me = players.find((p: any) => p.socketId === newSocket.id);
      if (me) {
        setMyGamePlayerId(me.gamePlayerId);
      }
    });

    newSocket.on('gameState', (state: GameState) => {
      console.log('[Client] Received gameState, deck.length:', state.deck.length);
      setGameState(state);
    });

    newSocket.on('error', (msg: string) => {
      setError(msg);
    });

    newSocket.on('gameFinished', (info) => {
      setGameFinishedInfo(info);
    });

    newSocket.on('info', (msg: string) => {
      // Show temporary info message (toast or alert)
      alert(msg);
    });

    newSocket.on('roomCreated', (roomId) => {
      setJoined(true);
    });

    newSocket.on('voteStarted', () => {
      setVoteState({ active: true, yes: 0, no: 0, startTime: Date.now() });
      setMyVote(null);
    });

    newSocket.on('voteUpdated', (data) => {
      setVoteState(prev => prev ? { ...prev, yes: data.yesVotes, no: data.noVotes } : null);
    });

    newSocket.on('voteFinished', (data) => {
      setVoteState(null);
      if (!data.ended) {
        alert('Oylama sonucu: Oyun sonlandırılmadı.');
      }
    });

    return () => { newSocket.close(); };
  }, []);

  useEffect(() => {
    if (!gameState || !gameState.turnStartTime) return;

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - gameState.turnStartTime) / 1000);
      const remaining = Math.max(0, 120 - elapsed);
      setTimeLeft(remaining);
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 500);
    return () => clearInterval(intervalId);
  }, [gameState?.turnStartTime, gameState?.currentPlayerId]);

  useEffect(() => {
    if (!voteState?.active || !voteState.startTime) return;
    
    const updateVoteTimer = () => {
      const elapsed = Math.floor((Date.now() - voteState.startTime) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setVoteTimeLeft(remaining);
    };
    
    updateVoteTimer();
    const intervalId = setInterval(updateVoteTimer, 500);
    return () => clearInterval(intervalId);
  }, [voteState?.active, voteState?.startTime]);

  const handleJoin = (uname: string, room: string) => {
    if (!socket) return;
    setUsername(uname);
    setRoomId(room);
    socket.emit('joinRoom', { username: uname, roomId: room });
    setJoined(true);
  };

  const handleCreate = (uname: string, room: string, settings: any) => {
    if (!socket) return;
    setUsername(uname);
    setRoomId(room);
    socket.emit('createRoom', { username: uname, roomId: room, settings });
  };

  const handleStartGame = () => {
    if (!socket || !roomId) return;
    socket.emit('startGame', { roomId });
  };

  const emitAction = (action: string, payload: any = {}) => {
    if (!socket || !roomId) return;
    socket.emit('action', { roomId, action, payload });
  };

  if (!joined || !myGamePlayerId) {
    return <Lobby onJoin={handleJoin} onCreate={handleCreate} error={error} />;
  }

  if (!gameState) {
    const emptySlots = 4 - roomPlayers.filter(p => !p.isBot).length;
    return (
      <div style={{color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#111', gap: '16px'}}>
        <h2 style={{color: '#ffd700', fontSize: '28px'}}>101 KUTLU</h2>
        <p style={{color: '#aaa'}}>Oda: <strong style={{color: 'white'}}>{roomId}</strong></p>
        <div style={{background: '#1e1e1e', borderRadius: '12px', padding: '24px', minWidth: '280px'}}>
          <p style={{marginBottom: '12px', color: '#aaa', textAlign: 'center'}}>Oyuncular ({roomPlayers.filter(p => !p.isBot).length}/4)</p>
          <ul style={{listStyle: 'none', padding: 0, margin: '0 0 24px 0'}}>
            {roomPlayers.map(p => (
              <li key={p.gamePlayerId} style={{color: p.isBot ? '#aaa' : 'white', padding: '8px 0', borderBottom: '1px solid #333'}}>
                {p.username} {p.gamePlayerId === myGamePlayerId && ' 🙋'} {p.isBot && '(Bot)'}
              </li>
            ))}
          </ul>
          
          <button 
            onClick={() => {
              const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
              navigator.clipboard.writeText(inviteLink);
              alert('Davetiye linki kopyalandı:\n' + inviteLink);
            }}
            style={{width: '100%', padding: '12px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '12px'}}
          >
            Davetiye Linkini Kopyala
          </button>

          {roomPlayers[0]?.gamePlayerId === myGamePlayerId ? (
            <button 
              onClick={handleStartGame}
              style={{width: '100%', padding: '12px', backgroundColor: '#ffd700', color: 'black', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer'}}
            >
              Oyunu Başlat (Eksikler Botla Doldurulur)
            </button>
          ) : (
            <p style={{color: '#aaa', textAlign: 'center', margin: 0}}>Kurucunun oyunu başlatması bekleniyor...</p>
          )}
        </div>
      </div>
    );
  }

  const playerIds = ['player1', 'player2', 'player3', 'player4'];
  const myIndex = playerIds.indexOf(myGamePlayerId);
  const rightId = playerIds[(myIndex + 1) % 4];
  const topId = playerIds[(myIndex + 2) % 4];
  const leftId = playerIds[(myIndex + 3) % 4];

  const me = gameState.players[myGamePlayerId as keyof typeof gameState.players];
  const topOpponent = gameState.players[topId as keyof typeof gameState.players];
  const leftOpponent = gameState.players[leftId as keyof typeof gameState.players];
  const rightOpponent = gameState.players[rightId as keyof typeof gameState.players];

  const p1TileCount = me.rack.filter((s: RackSlot) => s.tile !== null).length;
  const canDraw = gameState.currentPlayerId === myGamePlayerId && !gameState.hasDrawn && p1TileCount < 22; // Deck length removed - let server handle empty deck
  const canDiscard = gameState.currentPlayerId === myGamePlayerId && (gameState.hasDrawn || p1TileCount >= 22);

  const handleDrawDeck = () => {
    if (!canDraw) return;
    emitAction('DRAW_DECK');
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (gameFinishedInfo) return;
    const { active } = event;
    const tile = active.data.current as TileData;
    if (tile) setActiveTile(tile);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTile(null);
    if (gameFinishedInfo) return;
    const { active, over } = event;
    if (!over || !gameState) return;

    if (over.id === 'discard-area') {
      if (!canDiscard) {
        alert('Lütfen önce ortadan taş çekin!');
        return;
      }
      emitAction('DISCARD_TILE', { tileId: active.id });
      return;
    }

    if (typeof over.id === 'string' && over.id.startsWith('table-meld-')) {
      alert('Masaya işlemek şu an online versiyonda geçici kapalı.');
      return;
    }

    const activeSlotIndex = me.rack.findIndex((s: RackSlot) => s.tile?.id === active.id);
    const overSlotIndex = me.rack.findIndex((s: RackSlot) => s.id === over.id);
    if (activeSlotIndex !== -1 && overSlotIndex !== -1) {
      const newRack = [...me.rack];
      const activeSlot = newRack[activeSlotIndex];
      const overSlot = newRack[overSlotIndex];
      const tempTile = overSlot.tile;
      overSlot.tile = activeSlot.tile;
      activeSlot.tile = tempTile;
      emitAction('UPDATE_RACK', { newRack });
    }
  };

  const handleAutoSort = () => {
    if (isSorting) return; // Prevent double clicks
    setIsSorting(true);
    const sorted = autoSortSeries(me.rack);
    emitAction('UPDATE_RACK', { newRack: sorted });
    // Reset after a short delay (server will send updated state)
    setTimeout(() => setIsSorting(false), 500);
  };

  const handleAutoSortPairs = () => {
    if (isSorting) return; // Prevent double clicks
    setIsSorting(true);
    const sorted = autoSortPairs(me.rack);
    emitAction('UPDATE_RACK', { newRack: sorted });
    // Reset after a short delay (server will send updated state)
    setTimeout(() => setIsSorting(false), 500);
  };

  const handleOpenHand = () => {
    // Sıra sadece benimdeyken eli açabilirim
    if (gameState.currentPlayerId !== myGamePlayerId) {
      alert('Sıra sizde değilken eli açamazsınız!');
      return;
    }

    // Zaten açılmışsa tekrar açmaya izin ver (kalan taşları masaya eklemek için)
    const points = calculateRackPoints(me.rack);
    if (points.validBlocks.length === 0) {
      alert('Açılacak uygun grup bulunamadı!');
      return;
    }

    const leftoverRack = me.rack.map((s: RackSlot) => {
      const inBlock = points.validBlocks.flat().some(t => t.id === s.tile?.id);
      return inBlock ? { ...s, tile: null } : s;
    });
    emitAction('OPEN_HAND', { melds: points.validBlocks, newRack: leftoverRack });
  };

  const topDiscardPile = gameState.discardPiles[topId] || [];
  const leftDiscardPile = gameState.discardPiles[leftId] || [];
  const rightDiscardPile = gameState.discardPiles[rightId] || [];

  const topDiscard = topDiscardPile[topDiscardPile.length - 1];
  const leftDiscard = leftDiscardPile[leftDiscardPile.length - 1];
  const rightDiscard = rightDiscardPile[rightDiscardPile.length - 1];

  const handleVote = (vote: 'yes' | 'no') => {
    if (!socket || !roomId) return;
    setMyVote(vote);
    emitAction('CAST_VOTE', { vote: vote === 'yes' });
  };

  const handleStartVote = () => {
    console.log('handleStartVote called', { socket: !!socket, roomId });
    if (!socket || !roomId) {
      alert('Oylama başlatılamadı: Bağlantı hatası veya oda bulunamadı.');
      return;
    }
    console.log('Emitting START_VOTE');
    emitAction('START_VOTE');
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={`game-container ${gameState.currentPlayerId !== myGamePlayerId ? 'not-my-turn' : ''}`}>

        {timeLeft <= 10 && gameState.currentPlayerId === myGamePlayerId && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px',
            background: 'rgba(255,0,0,0.9)', padding: '15px 25px', borderRadius: '12px', 
            color: 'white', fontWeight: 'bold', fontSize: '18px', zIndex: 2000,
            boxShadow: '0 0 20px rgba(255,0,0,0.7)',
            animation: 'pulse-red 1s infinite',
            textAlign: 'center',
            maxWidth: '300px'
          }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳ Son {timeLeft} saniye!</div>
            <div style={{ fontSize: '14px', fontWeight: 'normal' }}>Eğer oynamazsanız elinizden bir taş ortaya atılacaktır.</div>
          </div>
        )}

        {voteState?.active && (
          <div className="modal-overlay" style={{ zIndex: 1000 }}>
            <div className="modal-content" style={{ background: '#2c3e50', padding: '30px' }}>
              <h2>Oyunu Sonlandırma Oylaması</h2>
              <p>Bir oyuncu oyunu sonlandırmak için oylama başlattı.<br/>Onaylıyor musunuz? (Evet oyları çoğunlukta olursa oyun biter)</p>
              <div style={{ margin: '15px 0', fontSize: '20px', color: '#ffeb3b', fontWeight: 'bold' }}>
                ⏳ Kalan Süre: {voteTimeLeft} saniye
              </div>
              
              <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', margin: '20px 0' }}>
                <button 
                  onClick={() => handleVote('yes')}
                  disabled={myVote !== null}
                  style={{ background: myVote === 'yes' ? '#27ae60' : '#4caf50', padding: '10px 20px', fontSize: '18px', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', opacity: myVote !== null && myVote !== 'yes' ? 0.5 : 1 }}
                >
                  Evet ({voteState.yes})
                </button>
                <button 
                  onClick={() => handleVote('no')}
                  disabled={myVote !== null}
                  style={{ background: myVote === 'no' ? '#c0392b' : '#f44336', padding: '10px 20px', fontSize: '18px', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', opacity: myVote !== null && myVote !== 'no' ? 0.5 : 1 }}
                >
                  Hayır ({voteState.no})
                </button>
              </div>
              <p style={{ color: '#aaa', fontSize: '14px' }}>30 saniye içinde cevap vermezseniz hayır sayılır.</p>
            </div>
          </div>
        )}

        {gameFinishedInfo && (
          <div className="modal-overlay">
            <div className="modal-content" style={{border: '2px solid #00e676'}}>
              <div className="modal-title" style={{color: '#00e676'}}>
                {(gameFinishedInfo as any).isGameEnded ? 'Oyun Bitti!' : 'El Bitti!'}
              </div>
              
              {(gameFinishedInfo as any).reason === 'deck_empty' ? (
                <>
                  <p style={{marginBottom: '10px', fontSize: '20px', color: '#ffb300'}}>Ortada Çekilecek Taş Kalmadı!</p>
                  <p style={{marginBottom: '20px', fontSize: '18px', color: '#ff5252'}}>Herkese 200 ceza puanı yazıldı.</p>
                </>
              ) : (gameFinishedInfo as any).reason === 'vote_ended' ? (
                <>
                  <p style={{marginBottom: '20px', fontSize: '20px', color: '#ffb300'}}>Oylama Sonucu Oyun Bitirildi!</p>
                </>
              ) : (
                <>
                  <p style={{marginBottom: '20px', fontSize: '20px'}}>
                    Kazanan: {gameState.players[gameFinishedInfo.winner as keyof typeof gameState.players]?.name}
                  </p>
                  {gameFinishedInfo.okeyFinish && <p style={{color: 'red'}}>Okey ile Bitti! (x2 Ceza)</p>}
                </>
              )}

              {(gameFinishedInfo as any).isGameEnded ? (
                <button className="modal-btn" onClick={() => window.location.reload()}>Ana Menüye Dön</button>
              ) : (
                <button className="modal-btn" onClick={() => {
                  if (roomPlayers[0]?.gamePlayerId === myGamePlayerId) {
                    emitAction('START_NEXT_ROUND');
                    setGameFinishedInfo(null);
                  } else {
                    alert('Kurucunun yeni eli başlatması bekleniyor...');
                  }
                }}>
                  {roomPlayers[0]?.gamePlayerId === myGamePlayerId ? 'Sıradaki Ele Geç' : 'Kurucuyu Bekle'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scoreboard Panel */}
        <div className="scoreboard-panel">
          <div className="scoreboard-title">Puan Tablosu</div>
          {roomPlayers.map(p => {
            const playerState = gameState.players[p.gamePlayerId as keyof typeof gameState.players];
            const score = playerState ? playerState.score : 0;
            const isActive = gameState.currentPlayerId === p.gamePlayerId;
            return (
              <div key={p.gamePlayerId} className="scoreboard-row" style={{color: isActive ? '#ffd700' : 'white', fontWeight: isActive ? 'bold' : 'normal'}}>
                <span>{p.username.substring(0, 10)}{p.gamePlayerId === myGamePlayerId ? ' 🙋' : ''}</span>
                <span style={{ color: score > 0 ? '#ff5252' : score < 0 ? '#4caf50' : 'white' }}>
                  {score > 0 ? `+${score}` : score} Puan
                </span>
              </div>
            );
          })}
        </div>

        {/* Last Discard Panel (Bottom Right) - Shows the most recently discarded tile */}
        <div style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          zIndex: 1000,
          pointerEvents: 'none'
        }}>
          {/* Show last 3 tiles from right opponent (previous player) overlapping */}
          {rightDiscardPile.length > 0 && (
            <div style={{ position: 'relative', width: '50px', height: '80px' }}>
              {rightDiscardPile.slice(-3).reverse().map((tile, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  bottom: `${i * 10}px`,
                  right: `${i * 5}px`,
                  transform: 'scale(0.85)',
                  zIndex: i
                }}>
                  <Tile tile={tile} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voting Button (Bottom Right) - Only show with 2+ real players */}
        {roomPlayers.filter(p => !p.isBot).length >= 2 && gameState && (
          <div style={{ position: 'absolute', bottom: '20px', right: '140px', zIndex: 1000, pointerEvents: 'auto' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                console.log('Button clicked!');
                handleStartVote();
              }}
              style={{
                background: 'linear-gradient(135deg, #f44336, #d32f2f)',
                color: 'white',
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                border: 'none',
                fontWeight: '600',
                fontSize: '11px',
                boxShadow: '0 2px 8px rgba(244, 67, 54, 0.3)',
                transition: 'transform 0.2s',
                whiteSpace: 'nowrap',
                pointerEvents: 'auto'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              🛑 Sonlandır
            </button>
          </div>
        )}

        {gameState.currentPlayerId !== myGamePlayerId && (
          <div className="turn-overlay">Rakiplerin Hamlesi Bekleniyor...</div>
        )}

        <div className="main-area">
          <div className="board-grid">
            <div className="table-area-center">
              <div className="table-meld-zones">
                <div className="board-logo-left">101<br/>KUTLU</div>
                <div className="board-logo-right">101<br/>KUTLU</div>
                
                <Opponent position="top" name={topOpponent.name.substring(0,8)} tileCount={topOpponent.rack.filter((s: RackSlot) => s.tile !== null).length} discard={topDiscard ? topDiscard.value.toString() : ''} isActive={gameState.currentPlayerId === topId} />
                <Opponent position="left" name={leftOpponent.name.substring(0,8)} tileCount={leftOpponent.rack.filter((s: RackSlot) => s.tile !== null).length} discard={leftDiscard ? leftDiscard.value.toString() : ''} isActive={gameState.currentPlayerId === leftId} />
                <Opponent position="right" name={rightOpponent.name.substring(0,8)} tileCount={rightOpponent.rack.filter((s: RackSlot) => s.tile !== null).length} discard={rightDiscard ? rightDiscard.value.toString() : ''} isActive={gameState.currentPlayerId === rightId} />

                <div className="table-melds-area">
                  {gameState.tableMelds.map((meld, index) => (
                    <TableMeldGroup key={index} meld={meld} index={index} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar">
            <div className="indicator-area" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ color: 'white', fontWeight: 'bold', marginBottom: '8px' }}>GÖSTERGE</div>
              <div style={{ transform: 'scale(0.8)', pointerEvents: 'none' }}>
                <Tile tile={gameState.indicator} />
              </div>
            </div>

            <div
              className="deck-placeholder flex-center"
              onClick={handleDrawDeck}
              style={{ cursor: canDraw ? 'pointer' : 'not-allowed', opacity: canDraw ? 1 : 0.4, marginTop: '10px', position: 'relative' }}
            >
              <div className="deck-count">{gameState.deck.length}</div>
              <div style={{ fontSize: '12px', lineHeight: '1' }}>DESTE<br/>ÇEK</div>
            </div>
          </div>
        </div>

        <div className="player-area-wrapper">
          <div style={{ opacity: canDiscard ? 1 : 0.4, transition: 'opacity 0.2s', pointerEvents: canDiscard ? 'auto' : 'none' }}>
            <DiscardArea />
          </div>
          
          <div style={{ position: 'absolute', bottom: '110px', right: '110px', pointerEvents: 'none', zIndex: 10 }}>
            {rightDiscardPile.slice(-5).map((tile, i) => (
              <div key={i} style={{ position: 'absolute', bottom: `${i * 10}px`, right: 0, transform: 'scale(0.8)', zIndex: i }}>
                <Tile tile={tile} />
              </div>
            ))}
            {rightDiscardPile.length > 0 && (
              <div style={{ position: 'absolute', bottom: '-20px', right: '-10px', color: '#aaa', fontSize: '12px', whiteSpace: 'nowrap' }}>
                Önceki Oyuncu
              </div>
            )}
          </div>

          <div className="point-indicator">
            <div className={`point-badge ${gameState.hasOpenedHand[myGamePlayerId] || calculateRackPoints(me.rack).totalSeriesPoints >= 101 ? 'valid' : 'invalid'}`}>
              SERİ: {calculateRackPoints(me.rack).totalSeriesPoints} / {gameState.hasOpenedHand[myGamePlayerId] ? 'AÇIK' : '101'}
            </div>
            <div className={`point-badge ${gameState.hasOpenedHand[myGamePlayerId] || calculateRackPoints(me.rack).totalPairs >= 5 ? 'valid' : 'invalid'}`}>
              ÇİFT: {calculateRackPoints(me.rack).totalPairs} / {gameState.hasOpenedHand[myGamePlayerId] ? 'AÇIK' : '5'}
            </div>
          </div>

          <div className="side-action-btn" onClick={handleAutoSortPairs} style={{ opacity: isSorting ? 0.5 : 1, cursor: isSorting ? 'wait' : 'pointer' }}>
            <div className="btn-icon">5 5</div>
            ÇİFT<br/>DİZ
          </div>

          <div className="rack-and-open">
            {gameState.currentPlayerId === myGamePlayerId && calculateRackPoints(me.rack).validBlocks.length > 0 && (
              <button className="open-hand-btn" onClick={handleOpenHand}>ELİ AÇ</button>
            )}
            <Rack slots={me.rack} />
          </div>

          <div className="side-action-btn" onClick={handleAutoSort} style={{ opacity: isSorting ? 0.5 : 1, cursor: isSorting ? 'wait' : 'pointer' }}>
            <div className="btn-icon" style={{color:'#0288d1', width:'40px'}}>1 2 3</div>
            SERİ<br/>DİZ
          </div>
        </div>

      </div>
      <DragOverlay dropAnimation={null}>
        {activeTile ? <Tile tile={activeTile} className="dragging-overlay-tile" /> : null}
      </DragOverlay>
    </DndContext>
  );
}
