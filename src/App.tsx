import React, { useState, useEffect } from 'react';
import './App.css';
import { initializeGame } from './utils/gameLogic';
import { playBotLogic, getBotDiscardDecision } from './utils/botAI';
import { autoSortSeries, autoSortPairs } from './utils/sortLogic';
import { calculateRackPoints, canAppendToMeld, isTilePlayable } from './utils/ruleEngine';
import type { GameState, TileData, MatchState, PlayerState } from './types';
import { Rack } from './components/Rack';
import { DiscardArea } from './components/DiscardArea';
import { TableMeldGroup } from './components/TableMeldGroup';
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

const turnOrder = ['player1', 'bot3', 'bot2', 'bot1'];

const Opponent: React.FC<{ position: 'top' | 'left' | 'right', name: string, tileCount: number, discard: string, isActive?: boolean }> = ({ position, name, tileCount: _tileCount, discard: _discard, isActive }) => {
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

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [matchState, setMatchState] = useState<MatchState>({
    currentRound: 1,
    maxRounds: 10,
    scores: { player1: 0, bot1: 0, bot2: 0, bot3: 0 },
    isRoundOver: false,
    isMatchOver: false,
    isKatlamali: false,
    highestSeriesPoint: 100,
    highestPairsPoint: 4
  });
  const [activeTile, setActiveTile] = useState<TileData | null>(null);
  const [lastRoundPenalties, setLastRoundPenalties] = useState<Record<string, number>>({});
  const [penaltyNotice, setPenaltyNotice] = useState<string | null>(null);

  const applyPenalty = (playerId: string, penalty: number, message: string) => {
    setMatchState(prev => ({
        ...prev,
        scores: {
           ...prev.scores,
           [playerId]: prev.scores[playerId as keyof typeof prev.scores] + penalty
        }
    }));
    setPenaltyNotice(message);
    setTimeout(() => setPenaltyNotice(null), 4000);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    setGameState(initializeGame(1));
  }, []);

  // End of Round check
  useEffect(() => {
    if (gameState && gameState.deck.length === 0 && !matchState.isRoundOver) {
      handleEndRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.deck.length]);

  const handleEndRound = (winnerId?: string, isOkeyFinish?: boolean) => {
    if (!gameState) return;
    
    const getPenalty = (p: PlayerState) => {
      let penalty = p.rack.reduce((sum, slot) => sum + (slot.tile ? slot.tile.value : 0), 0);
      if (isOkeyFinish && p.id !== winnerId) {
        penalty *= 2;
      }
      return penalty;
    };
    
    const p1Penalty = getPenalty(gameState.players.player1);
    const b1Penalty = getPenalty(gameState.players.bot1);
    const b2Penalty = getPenalty(gameState.players.bot2);
    const b3Penalty = getPenalty(gameState.players.bot3);

    const penalties = {
      player1: p1Penalty,
      bot1: b1Penalty,
      bot2: b2Penalty,
      bot3: b3Penalty
    };

    setLastRoundPenalties(penalties);

    setMatchState(prev => {
      const newScores = {
        player1: prev.scores.player1 + p1Penalty,
        bot1: prev.scores.bot1 + b1Penalty,
        bot2: prev.scores.bot2 + b2Penalty,
        bot3: prev.scores.bot3 + b3Penalty,
      };

      return {
        ...prev,
        scores: newScores,
        isRoundOver: true,
        isMatchOver: prev.currentRound >= prev.maxRounds
      };
    });
  };

  const startNextRound = () => {
    setMatchState(prev => {
      const nextRound = prev.currentRound + 1;
      setGameState(initializeGame(nextRound));
      return {
        ...prev,
        currentRound: nextRound,
        isRoundOver: false,
        highestSeriesPoint: 100, // Reset threshold for new round
        highestPairsPoint: 4
      };
    });
  };

  // Bot Turn Logic
  useEffect(() => {
    if (!gameState || matchState.isRoundOver) return;
    if (gameState.currentPlayerId === 'player1') return; 

    const botId = gameState.currentPlayerId;
    
    const drawTimer = setTimeout(() => {
      setGameState((prev) => {
        if (!prev || prev.deck.length === 0) return prev; 
        const newDeck = [...prev.deck];
        const newPlayers = { ...prev.players };
        const botState = { ...newPlayers[botId as keyof typeof newPlayers] };
        
        const botTileCount = botState.rack.filter(s => s.tile !== null).length;
        if (botTileCount >= 22) {
           return { ...prev, hasDrawn: true };
        }
        
        const drawnTile = newDeck.pop();
        const newRack = [...botState.rack];
        const emptyIndex = newRack.findIndex(s => s.tile === null);
        if (emptyIndex !== -1 && drawnTile) {
          newRack[emptyIndex] = { ...newRack[emptyIndex], tile: drawnTile };
        }
        botState.rack = newRack;
        newPlayers[botId as keyof typeof newPlayers] = botState;
        
        return {
          ...prev,
          deck: newDeck,
          players: newPlayers,
          hasDrawn: true
        };
      });

      // Bot daha uzun süre düşünür (2-3 saniye rastgele)
      const thinkTime = Math.floor(Math.random() * 1500) + 2000;
      setTimeout(() => {
        let discardedTileInfo: any = null;
        setGameState((prev) => {
          if (!prev || prev.deck.length === 0) return prev;
          const currentBotId = prev.currentPlayerId;
          const newPlayers = { ...prev.players };
          const botState = { ...newPlayers[currentBotId as keyof typeof newPlayers] };
          
          // 1. Play logic (Open hand, append to melds)
          const playResult = playBotLogic(
            currentBotId, 
            botState.rack, 
            prev.tableMelds, 
            prev.hasOpenedHand[currentBotId as keyof typeof prev.hasOpenedHand] || false,
            matchState
          );
          
          let newRack = playResult.newRack;
          const newTableMelds = playResult.newTableMelds;
          
          const hasOpenedNow = playResult.hasOpenedNow;
          let _highestSeries = matchState.highestSeriesPoint;
          let _highestPairs = matchState.highestPairsPoint;

          if (hasOpenedNow && !prev.hasOpenedHand[currentBotId as keyof typeof prev.hasOpenedHand] && matchState.isKatlamali) {
            // Update katlamalı score
            setMatchState(mPrev => ({
               ...mPrev,
               highestSeriesPoint: playResult.openedSeries ? Math.max(mPrev.highestSeriesPoint, calculateRackPoints(newRack).totalSeriesPoints) : mPrev.highestSeriesPoint,
               highestPairsPoint: playResult.openedPairs ? Math.max(mPrev.highestPairsPoint, calculateRackPoints(newRack).totalPairs) : mPrev.highestPairsPoint,
            }));
          }

          // 2. Discard logic
          let discardedTile = getBotDiscardDecision(newRack, newTableMelds);
          
          // Remove discarded tile from rack
          const slotIndex = newRack.findIndex(s => s.tile?.id === discardedTile.id);
          if (slotIndex !== -1) {
            newRack[slotIndex] = { ...newRack[slotIndex], tile: null };
          }
          
          const remainingTiles = newRack.filter(s => s.tile !== null).length;
          const isFinished = remainingTiles === 0;
          const finishedWithOkey = isFinished && discardedTile.isOkey;
          
          discardedTileInfo = { tile: discardedTile, botId: currentBotId, melds: newTableMelds, finishedWithOkey, isFinished };
          
          botState.rack = newRack;
          newPlayers[currentBotId as keyof typeof newPlayers] = botState;
          
          const newDiscardPiles = { ...prev.discardPiles };
          newDiscardPiles[currentBotId] = [...(newDiscardPiles[currentBotId] || []), discardedTile];
          
          const nextIndex = (turnOrder.indexOf(currentBotId) + 1) % turnOrder.length;
          
          return {
            ...prev,
            tableMelds: newTableMelds,
            hasOpenedHand: { ...prev.hasOpenedHand, [currentBotId]: hasOpenedNow },
            players: newPlayers,
            discardPiles: newDiscardPiles,
            currentPlayerId: turnOrder[nextIndex],
            hasDrawn: false
          };
        });

        if (discardedTileInfo) {
          if (isTilePlayable(discardedTileInfo.melds, discardedTileInfo.tile)) {
            const botName = { bot1: 'Bot 1', bot2: 'Bot 2', bot3: 'Bot 3' }[discardedTileInfo.botId as string];
            applyPenalty(discardedTileInfo.botId, 101, `${botName} İşlek Attı! +101 Ceza`);
          }
          
          if (discardedTileInfo.isFinished) {
            handleEndRound(discardedTileInfo.botId, discardedTileInfo.finishedWithOkey);
          }
        }
      }, thinkTime);
    }, 1500); // Taş çektikten sonra 1.5 saniye bekle 

    return () => clearTimeout(drawTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.currentPlayerId, matchState.isRoundOver]);

  const handleDrawDeck = () => {
    if (!gameState || matchState.isRoundOver) return;
    if (gameState.currentPlayerId !== 'player1') return;
    if (gameState.hasDrawn) return;
    if (gameState.deck.length === 0) return;

    setGameState((prev) => {
      if (!prev) return prev;
      const newDeck = [...prev.deck];
      const drawnTile = newDeck.pop();
      if (!drawnTile) return prev;

      const p1Rack = [...prev.players.player1.rack];
      const p1TileCount = p1Rack.filter(s => s.tile !== null).length;
      if (p1TileCount >= 22) {
        alert("Elinizde zaten 22 taş var, taş çekemezsiniz! Lütfen bir taş atın.");
        return prev;
      }

      const emptySlotIndex = p1Rack.findIndex(s => s.tile === null);
      if (emptySlotIndex === -1) {
        alert("Istakanızda yer yok!");
        return prev;
      }
      p1Rack[emptySlotIndex] = { ...p1Rack[emptySlotIndex], tile: drawnTile };

      return {
        ...prev,
        deck: newDeck,
        hasDrawn: true,
        players: { ...prev.players, player1: { ...prev.players.player1, rack: p1Rack } }
      };
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (matchState.isRoundOver) return;
    const { active } = event;
    const tile = active.data.current as TileData;
    if (tile) setActiveTile(tile);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTile(null);
    if (matchState.isRoundOver) return;
    const { active, over } = event;

    if (!over || !gameState) return;

    if (over.id === 'discard-area') {
      if (gameState.currentPlayerId !== 'player1') return;
      if (!gameState.hasDrawn) {
        const tileCount = gameState.players.player1.rack.filter(s => s.tile !== null).length;
        if (tileCount < 22) {
          alert("Lütfen önce ortadan taş çekin!");
          return;
        }
      }

      let islekPenaltyInfo: string | null = null;
      let okeyPenaltyInfo: string | null = null;
      let isFinished = false;
      let finishedWithOkey = false;

      setGameState((prev) => {
        if (!prev) return prev;
        const newRack = prev.players.player1.rack.map(s => ({ ...s }));
        const sourceIndex = newRack.findIndex(s => s.tile?.id === active.id);
        if (sourceIndex === -1) return prev;
        
        const discardedTile = newRack[sourceIndex].tile!;
        if (isTilePlayable(prev.tableMelds, discardedTile)) {
           islekPenaltyInfo = "İşlek Attınız! +101 Ceza";
        }
        // Yere Okey atma cezası (ayrı ceza)
        if (discardedTile.isOkey) {
           okeyPenaltyInfo = "Okey Attınız! +101 Ceza";
        }
        newRack[sourceIndex].tile = null;
        const remainingTiles = newRack.filter(s => s.tile !== null).length;
        if (remainingTiles === 0) {
          isFinished = true;
          if (discardedTile.isOkey) finishedWithOkey = true;
        }
        const newDiscardPiles = { ...prev.discardPiles };
        newDiscardPiles['player1'] = [...(newDiscardPiles['player1'] || []), discardedTile];
        
        const nextIndex = (turnOrder.indexOf('player1') + 1) % turnOrder.length;
        
        return {
          ...prev,
          players: { ...prev.players, player1: { ...prev.players.player1, rack: newRack } },
          discardPiles: newDiscardPiles,
          currentPlayerId: turnOrder[nextIndex],
          hasDrawn: false
        };
      });

      if (islekPenaltyInfo) applyPenalty('player1', 101, islekPenaltyInfo);
      if (okeyPenaltyInfo) applyPenalty('player1', 101, okeyPenaltyInfo);
      
      if (isFinished) {
        handleEndRound('player1', finishedWithOkey);
      }
      return;
    }

    if (typeof over.id === 'string' && over.id.startsWith('table-meld-')) {
      if (!gameState.hasOpenedHand['player1']) {
        alert("Masaya taş işlemek için önce kendi elinizi açmalısınız!");
        return;
      }
      
      const meldIndex = parseInt(over.id.replace('table-meld-', ''), 10);
      const draggedTile = active.data.current as TileData;
      const targetMeld = gameState.tableMelds[meldIndex];
      
      const appendCheck = canAppendToMeld(targetMeld, draggedTile);
      if (!appendCheck.valid) {
        alert("Bu taş buraya uyumlu değil!");
        return;
      }

      setGameState((prev) => {
        if (!prev) return prev;
        const newRack = prev.players.player1.rack.map(s => ({ ...s }));
        const sourceIndex = newRack.findIndex(s => s.tile?.id === active.id);
        if (sourceIndex === -1) return prev;
        
        newRack[sourceIndex].tile = null;
        const newTableMelds = [...prev.tableMelds];
        const newMeld = [...newTableMelds[meldIndex]];
        
        if (appendCheck.position === 'start') newMeld.unshift(draggedTile);
        else newMeld.push(draggedTile);
        
        newTableMelds[meldIndex] = newMeld;
        
        return {
          ...prev,
          tableMelds: newTableMelds,
          players: { ...prev.players, player1: { ...prev.players.player1, rack: newRack } }
        };
      });
      return;
    }

    setGameState((prev) => {
      if (!prev) return prev;
      const newRack = prev.players.player1.rack.map(slot => ({ ...slot }));
      const sourceGlobalIndex = newRack.findIndex(s => s.tile?.id === active.id);
      const targetGlobalIndex = newRack.findIndex(s => s.id === over.id);

      if (sourceGlobalIndex === -1 || targetGlobalIndex === -1) return prev;
      if (sourceGlobalIndex === targetGlobalIndex) return prev;

      const sourceRowStart = sourceGlobalIndex < 16 ? 0 : 16;
      const targetRowStart = targetGlobalIndex < 16 ? 0 : 16;

      if (sourceRowStart !== targetRowStart) {
        let isTargetRowFull = true;
        for (let i = targetRowStart; i < targetRowStart + 16; i++) {
          if (newRack[i].tile === null) {
            isTargetRowFull = false;
            break;
          }
        }
        if (isTargetRowFull) return prev;
      }

      const movedItem = newRack[sourceGlobalIndex].tile;
      newRack[sourceGlobalIndex].tile = null;

      if (newRack[targetGlobalIndex].tile === null) {
        newRack[targetGlobalIndex].tile = movedItem;
      } else {
        let rightEmpty = -1;
        for (let i = targetGlobalIndex; i < targetRowStart + 16; i++) {
          if (newRack[i].tile === null) { rightEmpty = i; break; }
        }
        let leftEmpty = -1;
        for (let i = targetGlobalIndex; i >= targetRowStart; i--) {
          if (newRack[i].tile === null) { leftEmpty = i; break; }
        }
        const distRight = rightEmpty !== -1 ? rightEmpty - targetGlobalIndex : 999;
        const distLeft = leftEmpty !== -1 ? targetGlobalIndex - leftEmpty : 999;

        if (distRight <= distLeft && rightEmpty !== -1) {
          for (let i = rightEmpty; i > targetGlobalIndex; i--) newRack[i].tile = newRack[i - 1].tile;
          newRack[targetGlobalIndex].tile = movedItem;
        } else if (leftEmpty !== -1) {
          for (let i = leftEmpty; i < targetGlobalIndex; i++) newRack[i].tile = newRack[i + 1].tile;
          newRack[targetGlobalIndex].tile = movedItem;
        } else {
          newRack[sourceGlobalIndex].tile = movedItem; 
        }
      }

      return {
        ...prev,
        players: { ...prev.players, player1: { ...prev.players.player1, rack: newRack } },
      };
    });
  };

  const handleAutoSort = () => {
    if (matchState.isRoundOver) return;
    setGameState((prev) => {
      if (!prev) return prev;
      const sortedRack = autoSortSeries(prev.players.player1.rack);
      return { ...prev, players: { ...prev.players, player1: { ...prev.players.player1, rack: sortedRack } } };
    });
  };

  const handleAutoSortPairs = () => {
    if (matchState.isRoundOver) return;
    setGameState((prev) => {
      if (!prev) return prev;
      const sortedRack = autoSortPairs(prev.players.player1.rack);
      return { ...prev, players: { ...prev.players, player1: { ...prev.players.player1, rack: sortedRack } } };
    });
  };

  const handleOpenHand = () => {
    if (matchState.isRoundOver) return;
    setGameState((prev) => {
      if (!prev) return prev;
      
      const p1Rack = prev.players.player1.rack;
      const pointsInfo = calculateRackPoints(p1Rack);
      const hasOpened = prev.hasOpenedHand.player1;
      
      const targetSeries = matchState.isKatlamali ? matchState.highestSeriesPoint + 1 : 101;
      const targetPairs = matchState.isKatlamali ? matchState.highestPairsPoint + 1 : 5;
      
      let canOpen = false;
      let usedSeries = false;
      let usedPairs = false;

      if (hasOpened) {
        if (pointsInfo.validBlocks.length > 0) canOpen = true;
      } else {
        if (pointsInfo.isValidSeriesOpening && pointsInfo.totalSeriesPoints >= targetSeries) {
          canOpen = true;
          usedSeries = true;
        }
        if (pointsInfo.isValidPairsOpening && pointsInfo.totalPairs >= targetPairs) {
          canOpen = true;
          usedPairs = true;
        }
      }

      if (!canOpen) {
        alert("Yeterli puanınız veya geçerli periniz yok!");
        return prev;
      }
      
      const newRack = p1Rack.map(s => ({ ...s }));
      const newTableMelds = [...prev.tableMelds];
      
      for (const block of pointsInfo.validBlocks) {
        newTableMelds.push(block);
        for (const tile of block) {
          const slot = newRack.find(s => s.tile?.id === tile.id);
          if (slot) slot.tile = null;
        }
      }
      
      if (!hasOpened && matchState.isKatlamali) {
         setMatchState(mPrev => ({
            ...mPrev,
            highestSeriesPoint: usedSeries ? Math.max(mPrev.highestSeriesPoint, pointsInfo.totalSeriesPoints) : mPrev.highestSeriesPoint,
            highestPairsPoint: usedPairs ? Math.max(mPrev.highestPairsPoint, pointsInfo.totalPairs) : mPrev.highestPairsPoint,
         }));
      }
      
      return {
        ...prev,
        tableMelds: newTableMelds,
        hasOpenedHand: { ...prev.hasOpenedHand, player1: true },
        players: { ...prev.players, player1: { ...prev.players.player1, rack: newRack } }
      };
    });
  };

  if (!gameState) {
    return <div className="loading flex-center">Oyun Yükleniyor...</div>;
  }

  const { player1 } = gameState.players;
  const topDiscard = gameState.discardPiles['bot2']?.slice(-1)[0];
  const leftDiscard = gameState.discardPiles['bot1']?.slice(-1)[0];
  const rightDiscard = gameState.discardPiles['bot3']?.slice(-1)[0];

  const p1TileCount = player1.rack.filter(s => s.tile !== null).length;
  const canDraw = gameState.currentPlayerId === 'player1' && !gameState.hasDrawn && p1TileCount < 22;
  const canDiscard = gameState.currentPlayerId === 'player1' && (gameState.hasDrawn || p1TileCount === 22);

  // Calculate ranks for match over
  const sortedScores = Object.entries(matchState.scores).sort((a, b) => a[1] - b[1]);

  return (
    <DndContext 
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={`game-container ${gameState.currentPlayerId !== 'player1' ? 'not-my-turn' : ''}`}>
        
        {penaltyNotice && (
          <div className="penalty-toast">{penaltyNotice}</div>
        )}

        {/* Scoreboard Panel */}
        <div className="scoreboard-panel">
          <div className="scoreboard-title">Tur {matchState.currentRound} / {matchState.maxRounds}</div>
          <div className="scoreboard-row"><span>Siz:</span> <span>{matchState.scores.player1}</span></div>
          <div className="scoreboard-row"><span>Bot 1 (Sol):</span> <span>{matchState.scores.bot1}</span></div>
          <div className="scoreboard-row"><span>Bot 2 (Üst):</span> <span>{matchState.scores.bot2}</span></div>
          <div className="scoreboard-row"><span>Bot 3 (Sağ):</span> <span>{matchState.scores.bot3}</span></div>
        </div>

        {gameState.currentPlayerId !== 'player1' && !matchState.isRoundOver && (
          <div className="turn-overlay">Rakiplerin Hamlesi Bekleniyor...</div>
        )}

        {/* Round Over Modal */}
        {matchState.isRoundOver && !matchState.isMatchOver && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-title">Tur Bitti!</div>
              <p style={{marginBottom: '20px'}}>Deste tükendi, herkes elinde kalan taşların toplamı kadar ceza puanı aldı.</p>
              <table className="modal-table">
                <thead>
                  <tr><th>Oyuncu</th><th>Ceza</th><th>Toplam Puan</th></tr>
                </thead>
                <tbody>
                  <tr><td>Siz</td><td style={{color:'#ff5252'}}>+{lastRoundPenalties.player1}</td><td>{matchState.scores.player1}</td></tr>
                  <tr><td>Bot 1</td><td style={{color:'#ff5252'}}>+{lastRoundPenalties.bot1}</td><td>{matchState.scores.bot1}</td></tr>
                  <tr><td>Bot 2</td><td style={{color:'#ff5252'}}>+{lastRoundPenalties.bot2}</td><td>{matchState.scores.bot2}</td></tr>
                  <tr><td>Bot 3</td><td style={{color:'#ff5252'}}>+{lastRoundPenalties.bot3}</td><td>{matchState.scores.bot3}</td></tr>
                </tbody>
              </table>
              <button className="modal-btn" onClick={startNextRound}>Sonraki Tura Geç</button>
            </div>
          </div>
        )}

        {/* Match Over Modal */}
        {matchState.isMatchOver && (
          <div className="modal-overlay">
            <div className="modal-content" style={{border: '2px solid #00e676'}}>
              <div className="modal-title" style={{color: '#00e676'}}>Oyun Bitti!</div>
              <p style={{marginBottom: '20px', fontSize: '20px'}}>10 Turluk Maç Sona Erdi.</p>
              <table className="modal-table">
                <thead>
                  <tr><th>Sıra</th><th>Oyuncu</th><th>Toplam Puan</th></tr>
                </thead>
                <tbody>
                  {sortedScores.map((entry, idx) => {
                    const nameMap: Record<string, string> = { player1: 'Siz', bot1: 'Bot 1', bot2: 'Bot 2', bot3: 'Bot 3'};
                    return (
                      <tr key={entry[0]} style={{fontWeight: idx === 0 ? 'bold' : 'normal', color: idx === 0 ? '#ffeb3b' : 'white'}}>
                        <td>{idx + 1}.</td>
                        <td>{nameMap[entry[0]]} {idx === 0 ? '🏆' : ''}</td>
                        <td>{entry[1]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="modal-btn" onClick={() => window.location.reload()}>Yeniden Oyna</button>
            </div>
          </div>
        )}

        <div className="main-area">
          <div className="board-grid">
            <div className="board-logo-left">101<br/>KUTLU</div>
            <div className="board-logo-right">101<br/>KUTLU</div>
            
            <Opponent position="top" name={gameState.players.bot2.name.substring(0,8)} tileCount={gameState.players.bot2.rack.filter(s=>s.tile!==null).length} discard={topDiscard ? `${topDiscard.value}` : ''} isActive={gameState.currentPlayerId === 'bot2'} />
            <Opponent position="left" name={gameState.players.bot1.name.substring(0,8)} tileCount={gameState.players.bot1.rack.filter(s=>s.tile!==null).length} discard={leftDiscard ? `${leftDiscard.value}` : ''} isActive={gameState.currentPlayerId === 'bot1'} />
            <Opponent position="right" name={gameState.players.bot3.name.substring(0,8)} tileCount={gameState.players.bot3.rack.filter(s=>s.tile!==null).length} discard={rightDiscard ? `${rightDiscard.value}` : ''} isActive={gameState.currentPlayerId === 'bot3'} />
            
            <div className="table-melds-area">
              {gameState.tableMelds.map((meld, index) => (
                <TableMeldGroup key={index} meld={meld} index={index} />
              ))}
            </div>
          </div>

          <div className="sidebar">
            <div className="sidebar-row">
              <div 
                className={`sidebar-btn ${matchState.isKatlamali ? 'btn-red' : 'btn-cyan'}`} 
                onClick={() => {
                  if (gameState.tableMelds.length === 0) {
                     setMatchState(prev => ({ ...prev, isKatlamali: !prev.isKatlamali }));
                  } else {
                     alert("Oyun başladıktan sonra Katlamalı ayarı değiştirilemez!");
                  }
                }}
                style={{ cursor: 'pointer', transition: 'all 0.3s' }}
              >
                {matchState.isKatlamali ? 'Katlamalı' : 'Tek'}
              </div>
              <div className="sidebar-white-box">
                 <div className="sidebar-white-box-text" style={{color:'#0277bd'}}>9 9</div>
                 <div className="sidebar-white-box-text" style={{color:'#1a1a1a'}}>9 9</div>
              </div>
            </div>
            
            {/* Okey Indicator */}
            <div className="indicator-area" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ color: 'white', fontWeight: 'bold', marginBottom: '8px' }}>GÖSTERGE</div>
              <div style={{ transform: 'scale(0.8)', pointerEvents: 'none' }}>
                <Tile tile={gameState.indicator} />
              </div>
            </div>

            {/* Clickable Deck */}
            <div 
              className="deck-placeholder flex-center" 
              onClick={handleDrawDeck} 
              style={{ 
                cursor: canDraw ? 'pointer' : 'not-allowed',
                opacity: canDraw ? 1 : 0.4,
                marginTop: '10px',
                position: 'relative'
              }}
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
          
          <div className="point-indicator">
            {(() => {
              const pointsInfo = calculateRackPoints(player1.rack);
              const targetSeries = matchState.isKatlamali ? matchState.highestSeriesPoint + 1 : 101;
              const targetPairs = matchState.isKatlamali ? matchState.highestPairsPoint + 1 : 5;
              const canOpenSeries = pointsInfo.totalSeriesPoints >= targetSeries;
              const canOpenPairs = pointsInfo.totalPairs >= targetPairs;
              return (
                <>
                  <div className={`point-badge ${gameState.hasOpenedHand.player1 || canOpenSeries ? 'valid' : 'invalid'}`}>
                    SERİ: {pointsInfo.totalSeriesPoints} / {gameState.hasOpenedHand.player1 ? 'AÇIK' : targetSeries}
                  </div>
                  <div className={`point-badge ${gameState.hasOpenedHand.player1 || canOpenPairs ? 'valid' : 'invalid'}`}>
                    ÇİFT: {pointsInfo.totalPairs} / {gameState.hasOpenedHand.player1 ? 'AÇIK' : targetPairs}
                  </div>
                </>
              );
            })()}
          </div>

          <div className="side-action-btn" onClick={handleAutoSortPairs}>
            <div className="btn-icon">5 5</div>
            ÇİFT<br/>DİZ
          </div>
          
          <div className="rack-and-open">
            {(() => {
              const pointsInfo = calculateRackPoints(player1.rack);
              const targetSeries = matchState.isKatlamali ? matchState.highestSeriesPoint + 1 : 101;
              const targetPairs = matchState.isKatlamali ? matchState.highestPairsPoint + 1 : 5;
              const canOpen = gameState.hasOpenedHand.player1
                ? pointsInfo.validBlocks.length > 0
                : (pointsInfo.totalSeriesPoints >= targetSeries || pointsInfo.totalPairs >= targetPairs);

              // Debug log
              console.log('🐛 ELİ AÇ Debug:', {
                seri: pointsInfo.totalSeriesPoints,
                cift: pointsInfo.totalPairs,
                targetSeries,
                targetPairs,
                isKatlamali: matchState.isKatlamali,
                hasOpened: gameState.hasOpenedHand.player1,
                canOpen
              });

              return canOpen ? <button className="open-hand-btn" onClick={handleOpenHand}>ELİ AÇ</button> : null;
            })()}
            <Rack slots={player1.rack} />
          </div>

          <div className="side-action-btn" onClick={handleAutoSort}>
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

export default App;


