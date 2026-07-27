import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { initializeGame } from './utils/gameLogic';
import { GameState, RoomSettings } from './types';
import { playBotLogic, getBotDiscardDecision } from './utils/botAI';
import { isTilePlayable } from './utils/ruleEngine';

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const BOT_NAMES = ['Bot Ahmet', 'Bot Mehmet', 'Bot Ayşe'];
const TURN_ORDER = ['player1', 'player4', 'player3', 'player2'];

interface RoomPlayer {
  socketId: string;
  username: string;
  gamePlayerId: string;
  isBot: boolean;
}

interface Room {
  id: string;
  players: RoomPlayer[];
  gameState: GameState | null;
  botTimers: ReturnType<typeof setTimeout>[];
  turnTimer: ReturnType<typeof setTimeout> | null;
  settings: RoomSettings;
  voteActive: boolean;
  voteTimer: ReturnType<typeof setTimeout> | null;
  votes: Record<string, boolean>; // true for Yes, false for No
}

const rooms: Record<string, Room> = {};

function sanitizeState(state: GameState, myGamePlayerId: string): GameState {
  const sanitized = JSON.parse(JSON.stringify(state)) as GameState;
  for (const pid in sanitized.players) {
    if (pid !== myGamePlayerId) {
      sanitized.players[pid].rack = sanitized.players[pid].rack.map((slot: any) => ({
        ...slot,
        tile: slot.tile ? { id: slot.tile.id, color: 'none', value: 0, isOkey: false, isFalseOkey: false } : null
      })) as any;
    }
  }
  return sanitized;
}

// Deste bittiğinde en az taşı olan oyuncuyu bul
function findPlayerWithFewestTiles(state: GameState): string | null {
  let minTiles = Infinity;
  let winners: string[] = [];

  for (const pid in state.players) {
    const tileCount = state.players[pid].rack.filter((s: any) => s.tile !== null).length;
    if (tileCount < minTiles) {
      minTiles = tileCount;
      winners = [pid];
    } else if (tileCount === minTiles) {
      winners.push(pid);
    }
  }

  // Beraberlik varsa, en az puana sahip olanı seç
  if (winners.length > 1) {
    winners.sort((a, b) => state.players[a].score - state.players[b].score);
  }

  return winners[0];
}

function calculateEndRoundScores(state: GameState, winner: string | null, okeyFinish: boolean, settings: RoomSettings) {
  const multiplier = (okeyFinish && settings.okeyCezasi) ? 2 : 1;

  // Kazananın çift sayısını hesapla (bonus için)
  let winnerPairs = 0;
  if (winner) {
    const winnerRack = state.players[winner].rack;
    // Çift sayısını hesapla (iki taş, aynı sayı ve renk)
    for (let i = 0; i < winnerRack.length - 1; i++) {
      const t1 = winnerRack[i].tile;
      const t2 = winnerRack[i + 1].tile;
      if (t1 && t2 && t1.value === t2.value && t1.color === t2.color && t1.isOkey === t2.isOkey && t1.isFalseOkey === t2.isFalseOkey) {
        winnerPairs++;
        i++; // Bir sonraki taşı atla (çift olduğu için)
      }
    }
  }

  for (const pid in state.players) {
    if (pid === winner) {
      // Kazanan: 101 puan + çift bonusu
      const bonus = winnerPairs * 10;
      state.players[pid].score += 101 + bonus;
    } else {
      let penalty = 0;
      if (state.hasOpenedHand[pid]) {
        let sum = 0;
        state.players[pid].rack.forEach((s: any) => {
          if (s.tile) sum += s.tile.value;
        });
        penalty = sum;
      } else {
        penalty = 200;
      }
      // Kaybedenlere CEZA yazılır (negatif puan)
      state.players[pid].score -= penalty * multiplier;
    }
  }

  // Check if max score is reached
  const gameEnded = Object.values(state.players).some((p: any) => p.score >= settings.maxScore);
  return gameEnded;
}

function startTurnTimer(roomId: string) {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;

  if (room.turnTimer) clearTimeout(room.turnTimer);

  const state = room.gameState;
  state.turnStartTime = Date.now();

  console.log(`[${new Date().toISOString()}] Timer started: room=${roomId}, player=${state.currentPlayerId}, hasDrawn=${state.hasDrawn}`);

  room.turnTimer = setTimeout(() => {
    const r = rooms[roomId];
    if (!r || !r.gameState) {
      console.log(`[${new Date().toISOString()}] Timeout fired but room or gameState is null for room ${roomId}`);
      return;
    }
    const s = r.gameState;
    const currentId = s.currentPlayerId;

    console.log(`[${new Date().toISOString()}] TIMEOUT fired for room ${roomId}, player ${currentId}, hasDrawn: ${s.hasDrawn}`);

    // Is it a bot? bots shouldn't hit this timeout usually, but just in case
    const player = r.players.find(p => p.gamePlayerId === currentId);
    if (player?.isBot) {
      console.log(`[${new Date().toISOString()}] Timeout but player is bot, skipping auto-play`);
      return;
    }

    // Auto-draw if hasn't drawn
    if (!s.hasDrawn) {
      const tileCount = s.players[currentId].rack.filter((sl: any) => sl.tile !== null).length;
      console.log(`[${new Date().toISOString()}] Auto-draw: tileCount=${tileCount}, deckLength=${s.deck.length}`);
      // If deck has tiles, draw first
      if (tileCount < 22 && s.deck.length > 0) {
        const drawnTile = s.deck.pop()!;
        const emptyIdx = s.players[currentId].rack.findIndex((sl: any) => sl.tile === null);
        if (emptyIdx !== -1) s.players[currentId].rack[emptyIdx].tile = drawnTile;
        s.hasDrawn = true;
        console.log(`[${new Date().toISOString()}] Auto-drew tile: ${drawnTile.color}${drawnTile.value}`);
      }
      // If deck is empty or already has 22 tiles, player can discard directly
    }

    // Auto-discard random tile
    const rack = s.players[currentId].rack;
    const validSlots = rack.filter((sl: any) => sl.tile !== null);
    console.log(`[${new Date().toISOString()}] Auto-discard: validSlots=${validSlots.length}`);
    if (validSlots.length > 0) {
      const randomSlot = validSlots[Math.floor(Math.random() * validSlots.length)];
      const sourceIndex = rack.findIndex((sl: any) => sl.id === randomSlot.id);

      const discardedTile = rack[sourceIndex].tile!;
      rack[sourceIndex].tile = null;

      if (!s.discardPiles[currentId]) s.discardPiles[currentId] = [];
      s.discardPiles[currentId].push(discardedTile);

      console.log(`[${new Date().toISOString()}] Auto-discarded tile: ${discardedTile.color}${discardedTile.value}`);

      const remainingTiles = rack.filter((sl: any) => sl.tile !== null).length;
      if (remainingTiles === 0) {
        const isGameEnded = calculateEndRoundScores(s, currentId, discardedTile.isOkey, room.settings);
        broadcastState(roomId);
        io.to(roomId).emit('gameFinished', { winner: currentId, okeyFinish: discardedTile.isOkey, isGameEnded });
        return;
      }
    }

    // Pass turn
    const nextIndex = (TURN_ORDER.indexOf(currentId) + 1) % TURN_ORDER.length;
    const nextId = TURN_ORDER[nextIndex];
    console.log(`[${new Date().toISOString()}] Passing turn from ${currentId} to ${nextId}`);
    s.currentPlayerId = nextId;
    s.hasDrawn = false;
    broadcastState(roomId);
    
    // Check if next is bot
    const nextPlayer = r.players.find(p => p.gamePlayerId === s.currentPlayerId);
    if (nextPlayer?.isBot) {
      scheduleBotTurn(roomId);
    } else {
      startTurnTimer(roomId);
    }
  }, 120000); // 120 seconds (2 minutes)
}

function broadcastState(roomId: string) {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;
  console.log(`[${new Date().toISOString()}] Broadcasting state for room ${roomId}, deckLength: ${room.gameState.deck.length}`);
  for (const player of room.players) {
    if (player.isBot) continue;
    const sanitized = sanitizeState(room.gameState, player.gamePlayerId);
    console.log(`[${new Date().toISOString()}] Sending to ${player.username} (${player.gamePlayerId}), sanitized deckLength: ${sanitized.deck.length}`);
    io.to(player.socketId).emit('gameState', sanitized);
  }
}

function scheduleBotTurn(roomId: string) {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;

  const state = room.gameState;
  const currentId = state.currentPlayerId;
  const currentPlayer = room.players.find(p => p.gamePlayerId === currentId);

  if (!currentPlayer || !currentPlayer.isBot) return;
  if (state.deck.length === 0) return;

  const timer = setTimeout(() => {
    const r = rooms[roomId];
    if (!r || !r.gameState) return;
    const s = r.gameState;
    if (s.currentPlayerId !== currentId) return;

    // Bot draws a tile if needed
    const botRack = s.players[currentId].rack;
    const currentTileCount = botRack.filter((sl: any) => sl.tile !== null).length;
    
    if (currentTileCount < 22) {
      if (s.deck.length === 0) {
        // Deck empty - find player with fewest tiles and end round
        console.log(`[${new Date().toISOString()}] Deck empty (bot turn), finding winner...`);
        const winner = findPlayerWithFewestTiles(s);
        const isGameEnded = calculateEndRoundScores(s, winner, false, r.settings);
        broadcastState(roomId);
        io.to(roomId).emit('gameFinished', { winner, reason: 'deck_empty', isGameEnded });
        return;
      }
      const drawnTile = s.deck.pop()!;
      const emptyIdx = botRack.findIndex((sl: any) => sl.tile === null);
      if (emptyIdx !== -1) botRack[emptyIdx].tile = drawnTile;
      s.hasDrawn = true;
    }

    // Bot plays logic
    const playResult = playBotLogic(
      botRack,
      s.tableMelds,
      s.hasOpenedHand[currentId] || false
    );
    s.players[currentId].rack = playResult.newRack;
    s.tableMelds = playResult.newTableMelds;
    if (playResult.hasOpenedNow) s.hasOpenedHand[currentId] = true;

    // Bot discards
    const discardTile = getBotDiscardDecision(s.players[currentId].rack, s.tableMelds);
    const discardIdx = s.players[currentId].rack.findIndex((sl: any) => sl.tile?.id === discardTile.id);
    if (discardIdx !== -1) s.players[currentId].rack[discardIdx].tile = null;

    // İşlek atma cezası kontrolü (ayara göre)
    if (room.settings.islekCezasi && isTilePlayable(s.tableMelds, discardTile)) {
      s.scores[currentId] += 101;
      io.to(roomId).emit('penalty', { playerId: currentId, penalty: 101, reason: `${currentState.players.find((p: any) => p.id === currentId)?.name || 'Bot'} İşlek Attı!` });
    }
    // Yere Okey atma cezası (ayara göre)
    if (room.settings.okeyCezasi && discardTile.isOkey) {
      s.scores[currentId] += 101;
      io.to(roomId).emit('penalty', { playerId: currentId, penalty: 101, reason: `${currentState.players.find((p: any) => p.id === currentId)?.name || 'Bot'} Okey Attı!` });
    }

    if (!s.discardPiles[currentId]) s.discardPiles[currentId] = [];
    s.discardPiles[currentId].push(discardTile);

    const remaining = s.players[currentId].rack.filter((sl: any) => sl.tile !== null).length;
    if (remaining === 0) {
      const isGameEnded = calculateEndRoundScores(s, currentId, discardTile.isOkey, room.settings);
      broadcastState(roomId); // Broadcast final scores
      io.to(roomId).emit('gameFinished', { winner: currentId, okeyFinish: discardTile.isOkey, isGameEnded });
      return; // Stop bot loop if game ended
    }

    const nextIndex = (TURN_ORDER.indexOf(currentId) + 1) % TURN_ORDER.length;
    s.currentPlayerId = TURN_ORDER[nextIndex];
    s.hasDrawn = false;

    broadcastState(roomId);
    
    const nextPlayer = r.players.find(p => p.gamePlayerId === s.currentPlayerId);
    if (nextPlayer?.isBot) {
      scheduleBotTurn(roomId);
    } else {
      startTurnTimer(roomId);
    }
  }, 1500);

  room.botTimers.push(timer);
}

function startGame(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;

  // Fill remaining slots with bots
  let botIndex = 0;
  const playerIds = ['player1', 'player2', 'player3', 'player4'];
  const usedIds = room.players.map(p => p.gamePlayerId);

  for (const pid of playerIds) {
    if (!usedIds.includes(pid)) {
      room.players.push({
        socketId: '',
        username: BOT_NAMES[botIndex] || `Bot ${botIndex + 1}`,
        gamePlayerId: pid,
        isBot: true
      });
      botIndex++;
    }
  }

  room.gameState = initializeGame(1);

  // Set player names
  for (const p of room.players) {
    room.gameState.players[p.gamePlayerId].name = p.username;
  }

  // Broadcast initial state to real players
  broadcastState(roomId);

  // Send room update so clients know bots filled in
  io.to(roomId).emit('roomUpdate', room.players.map(p => ({
    username: p.username,
    gamePlayerId: p.gamePlayerId,
    socketId: p.socketId,
    isBot: p.isBot
  })));

  const firstPlayer = room.players.find(p => p.gamePlayerId === room.gameState!.currentPlayerId);
  if (firstPlayer?.isBot) {
    scheduleBotTurn(roomId);
  } else {
    startTurnTimer(roomId);
  }
}

io.on('connection', (socket: Socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', ({ username, roomId, settings }) => {
    if (rooms[roomId]) {
      socket.emit('error', 'Bu oda kodu zaten kullanımda!');
      return;
    }
    rooms[roomId] = {
      id: roomId,
      players: [],
      gameState: null,
      botTimers: [],
      turnTimer: null,
      settings: settings || { isKatlamali: false, islekCezasi: false, okeyCezasi: false, maxScore: 800 },
      voteActive: false,
      voteTimer: null,
      votes: {}
    };
    
    // Kurucu da odaya katılsın
    const gamePlayerId = 'player1';
    rooms[roomId].players.push({ socketId: socket.id, username, gamePlayerId, isBot: false });
    socket.join(roomId);

    io.to(roomId).emit('roomUpdate', rooms[roomId].players.map(p => ({
      username: p.username,
      gamePlayerId: p.gamePlayerId,
      socketId: p.socketId,
      isBot: p.isBot
    })));
    socket.emit('roomCreated', roomId);
  });

  socket.on('joinRoom', ({ username, roomId }) => {
    if (!rooms[roomId]) {
      socket.emit('error', 'Bu Oda Bulunmamaktadır');
      return;
    }
    const room = rooms[roomId];

    if (room.gameState) {
      socket.emit('error', 'Oyun zaten başladı!');
      return;
    }

    const realPlayers = room.players.filter(p => !p.isBot);
    if (realPlayers.length >= 4) {
      socket.emit('error', 'Oda dolu!');
      return;
    }

    const gamePlayerId = `player${realPlayers.length + 1}`;
    room.players.push({ socketId: socket.id, username, gamePlayerId, isBot: false });
    socket.join(roomId);

    io.to(roomId).emit('roomUpdate', room.players.map(p => ({
      username: p.username,
      gamePlayerId: p.gamePlayerId,
      socketId: p.socketId,
      isBot: p.isBot
    })));
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (room.gameState) return; // already started
    startGame(roomId);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);

        const realPlayersCount = room.players.filter(p => !p.isBot).length;

        if (realPlayersCount === 0 && room.gameState) {
          // Last real player disconnected - end the game
          console.log(`[${new Date().toISOString()}] Last real player disconnected, ending game in room ${roomId}`);
          room.botTimers.forEach(t => clearTimeout(t));
          if (room.turnTimer) clearTimeout(room.turnTimer);
          if (room.voteTimer) clearTimeout(room.voteTimer);

          // Send game finished event before deleting
          io.to(roomId).emit('gameFinished', {
            winner: null,
            reason: 'player_disconnected',
            isGameEnded: true
          });

          delete rooms[roomId];
        } else if (realPlayersCount === 0) {
          // Game not started, just delete the room
          room.botTimers.forEach(t => clearTimeout(t));
          if (room.turnTimer) clearTimeout(room.turnTimer);
          if (room.voteTimer) clearTimeout(room.voteTimer);
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('roomUpdate', room.players.map(p => ({
            username: p.username,
            gamePlayerId: p.gamePlayerId,
            socketId: p.socketId,
            isBot: p.isBot
          })));
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });

  socket.on('action', ({ roomId, action, payload }) => {
    console.log(`[${new Date().toISOString()}] Action received: ${action}, room: ${roomId}, socket: ${socket.id}`);

    const room = rooms[roomId];
    if (!room || !room.gameState) {
      console.log(`[${new Date().toISOString()}] Action rejected: room or gameState missing. room: ${!!room}, gameState: ${!!room?.gameState}`);
      return;
    }
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      console.log(`[${new Date().toISOString()}] Action rejected: player not found`);
      return;
    }

    const state = room.gameState;
    const myId = player.gamePlayerId;

    if (action === 'DRAW_DECK') {
      console.log(`[${new Date().toISOString()}] DRAW_DECK attempt - room: ${roomId}, player: ${myId}, deckLength: ${state.deck.length}, hasDrawn: ${state.hasDrawn}, currentTileCount: ${state.players[myId].rack.filter((s: any) => s.tile !== null).length}`);
      if (state.currentPlayerId !== myId || state.hasDrawn) {
        console.log(`[${new Date().toISOString()}] DRAW_DECK rejected - wrong player or already drawn`);
        return;
      }
      const currentTileCount = state.players[myId].rack.filter((s: any) => s.tile !== null).length;
      if (currentTileCount >= 22) {
        console.log(`[${new Date().toISOString()}] DRAW_DECK rejected - tileCount >= 22`);
        return; // 22 taşı varsa çekemez
      }
      if (state.deck.length === 0) {
        // Deck empty - find player with fewest tiles and end round
        console.log(`[${new Date().toISOString()}] Deck empty (before draw), finding winner...`);
        const winner = findPlayerWithFewestTiles(state);
        const isGameEnded = calculateEndRoundScores(state, winner, false, room.settings);
        broadcastState(roomId);
        io.to(roomId).emit('gameFinished', { winner, reason: 'deck_empty', isGameEnded });
        return;
      }
      const drawnTile = state.deck.pop();
      if (!drawnTile) {
        // Deck empty after pop - find player with fewest tiles and end round
        console.log(`[${new Date().toISOString()}] Deck empty (after pop), finding winner...`);
        const winner = findPlayerWithFewestTiles(state);
        const isGameEnded = calculateEndRoundScores(state, winner, false, room.settings);
        broadcastState(roomId);
        io.to(roomId).emit('gameFinished', { winner, reason: 'deck_empty', isGameEnded });
        return;
      }
      const emptySlotIndex = state.players[myId].rack.findIndex((s: any) => s.tile === null);
      if (emptySlotIndex !== -1) {
        state.players[myId].rack[emptySlotIndex].tile = drawnTile;
        state.hasDrawn = true;

        // Check if deck is now empty after drawing
        if (state.deck.length === 0) {
          // Deck empty - find player with fewest tiles and end round
          console.log(`[${new Date().toISOString()}] Deck empty (after draw), finding winner...`);
          const winner = findPlayerWithFewestTiles(state);
          const isGameEnded = calculateEndRoundScores(state, winner, false, room.settings);
          broadcastState(roomId);
          io.to(roomId).emit('gameFinished', { winner, reason: 'deck_empty', isGameEnded });
          return;
        }

        broadcastState(roomId);
      }
    } else if (action === 'DISCARD_TILE') {
      const tileCount = state.players[myId].rack.filter((s: any) => s.tile !== null).length;
      const canDiscard = state.hasDrawn || tileCount >= 22;
      if (state.currentPlayerId !== myId || !canDiscard) return;
      const sourceIndex = state.players[myId].rack.findIndex((s: any) => s.tile?.id === payload.tileId);
      if (sourceIndex === -1) return;
      const discardedTile = state.players[myId].rack[sourceIndex].tile!;
      state.players[myId].rack[sourceIndex].tile = null;

      // İşlek atma cezası kontrolü (ayara göre)
      if (room.settings.islekCezasi && isTilePlayable(state.tableMelds, discardedTile)) {
        state.scores[myId] += 101;
        io.to(roomId).emit('penalty', { playerId: myId, penalty: 101, reason: 'İşlek Attı!' });
      }
      // Yere Okey atma cezası (ayara göre)
      if (room.settings.okeyCezasi && discardedTile.isOkey) {
        state.scores[myId] += 101;
        io.to(roomId).emit('penalty', { playerId: myId, penalty: 101, reason: 'Okey Attı!' });
      }

      const remainingTiles = state.players[myId].rack.filter((s: any) => s.tile !== null).length;
      if (remainingTiles === 0) {
        const isGameEnded = calculateEndRoundScores(state, myId, discardedTile.isOkey, room.settings);
        broadcastState(roomId); // Broadcast final scores
        io.to(roomId).emit('gameFinished', { winner: myId, okeyFinish: discardedTile.isOkey, isGameEnded });
        return; // Early return to avoid changing turn if game is over
      }
      state.discardPiles[myId] = [...(state.discardPiles[myId] || []), discardedTile];
      const nextIndex = (TURN_ORDER.indexOf(myId) + 1) % TURN_ORDER.length;
      state.currentPlayerId = TURN_ORDER[nextIndex];
      state.hasDrawn = false;
      broadcastState(roomId);
      
      const nextPlayer = room.players.find(p => p.gamePlayerId === state.currentPlayerId);
      if (nextPlayer?.isBot) {
        scheduleBotTurn(roomId);
      } else {
        startTurnTimer(roomId);
      }
    } else if (action === 'OPEN_HAND') {
      if (state.currentPlayerId !== myId) return;

      if (room.settings.isKatlamali) {
        const { isSeries, isPairs, seriesPoint, pairsPoint } = payload;
        
        if (isSeries) {
          if (state.highestSeriesPoint > 0 && seriesPoint <= state.highestSeriesPoint) {
            socket.emit('error', `Katlamalı mod! Seri açmak için ${state.highestSeriesPoint} puandan fazlasını açmalısınız.`);
            return;
          }
          state.highestSeriesPoint = seriesPoint;
        } else if (isPairs) {
          if (state.highestPairsPoint > 0 && pairsPoint <= state.highestPairsPoint) {
            socket.emit('error', `Katlamalı mod! Çift açmak için ${state.highestPairsPoint} çiftten fazlasını açmalısınız.`);
            return;
          }
          state.highestPairsPoint = pairsPoint;
        }
      }

      state.tableMelds = [...state.tableMelds, ...payload.melds];
      state.players[myId].rack = payload.newRack;
      state.hasOpenedHand[myId] = true;
      broadcastState(roomId);
    } else if (action === 'UPDATE_RACK') {
      state.players[myId].rack = payload.newRack;
      broadcastState(roomId);
    } else if (action === 'START_VOTE') {
      if (room.voteActive) return; // Already voting

      const realPlayersCount = room.players.filter(p => !p.isBot).length;
      if (realPlayersCount <= 1) {
        socket.emit('error', 'Oylama başlatmak için en az 2 gerçek oyuncu olmalı!');
        return;
      }

      room.voteActive = true;
      room.votes = {};
      room.votes[myId] = true; // Starter automatically votes Yes

      io.to(roomId).emit('voteStarted', { starterId: myId });

      room.voteTimer = setTimeout(() => {
        finalizeVote(roomId);
      }, 30000); // 30 seconds for voting
    } else if (action === 'CAST_VOTE') {
      if (!room.voteActive) return;
      if (room.votes[myId] !== undefined) return; // Already voted
      room.votes[myId] = payload.vote;
      
      // If everyone voted, finish early
      const realPlayers = room.players.filter(p => !p.isBot);
      if (Object.keys(room.votes).length === realPlayers.length) {
        if (room.voteTimer) clearTimeout(room.voteTimer);
        finalizeVote(roomId);
      }
    } else if (action === 'START_NEXT_ROUND') {
      const existingScores: Record<string, number> = {};
      for (const pid in state.players) {
        existingScores[pid] = state.players[pid].score;
      }
      // Assuming roundNumber logic here, we'll just pass 1 for now or increment if we tracked it
      room.gameState = initializeGame(1, existingScores);
      room.gameState.turnStartTime = Date.now();
      broadcastState(roomId);
      const nextPlayer = room.players.find(p => p.gamePlayerId === room.gameState!.currentPlayerId);
      if (nextPlayer?.isBot) {
        scheduleBotTurn(roomId);
      } else {
        startTurnTimer(roomId);
      }
    }
  });
});

function finalizeVote(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;
  room.voteActive = false;

  const realPlayers = room.players.filter(p => !p.isBot);
  let yesVotes = 0;
  let noVotes = 0;

  for (const p of realPlayers) {
    if (room.votes[p.gamePlayerId] === true) yesVotes++;
    else noVotes++; // Non-voters and NO votes are treated as NO
  }

  io.to(roomId).emit('voteFinished', { yesVotes, noVotes });

  // Majority means more than 50% of real players voted YES
  const requiredVotes = Math.floor(realPlayers.length / 2) + 1;

  if (yesVotes >= requiredVotes) {
    // End game - majority voted YES
    if (room.gameState) {
      calculateEndRoundScores(room.gameState, null, false, room.settings);
      broadcastState(roomId);
      io.to(roomId).emit('gameFinished', { winner: null, reason: 'vote_ended', isGameEnded: true });
    }
  }
  // If majority voted NO, game continues (no action needed)
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
