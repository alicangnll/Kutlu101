import type { TileData, TileColor, GameState, RackSlot } from '../types';

export const COLORS: TileColor[] = ['red', 'black', 'blue', 'yellow'];

export function generateDeck(): TileData[] {
  const deck: TileData[] = [];
  let idCounter = 0;

  // Generate 2 sets of 1-13 for each color
  for (let set = 0; set < 2; set++) {
    for (const color of COLORS) {
      for (let value = 1; value <= 13; value++) {
        deck.push({
          id: `tile-${idCounter++}`,
          color,
          value,
          isFalseOkey: false, isOkey: false,
        });
      }
    }
  }

  // Add 2 false okeys
  deck.push({ id: `tile-${idCounter++}`, color: 'black', value: 0, isFalseOkey: true, isOkey: false });
  deck.push({ id: `tile-${idCounter++}`, color: 'black', value: 0, isFalseOkey: true, isOkey: false });

  return deck;
}

export function shuffleDeck(deck: TileData[]): TileData[] {
  // Gerçekçi Okey Karıştırması (Imperfect Shuffle)
  // İnsanlar taşları masada iki eliyle karıştırırken mükemmel bir rastgelelik oluşmaz.
  // Önceki elden kalan perler (gruplar/seriler) sık sık birbirine yakın kalır.
  
  const shuffled = [...deck];
  const n = shuffled.length;
  
  // 1. Kısmi Karıştırma (Weak Fisher-Yates)
  // Tüm desteyi değil, destenin sadece bir kısmını rastgele yer değiştiriyoruz.
  // Bu sayede generateDeck içindeki bazı sıralı bloklar (1,2,3) bozulmadan kalır.
  for (let i = n - 1; i > Math.floor(n * 0.3); i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // 2. Desteyi Kesme (Cutting the deck)
  // Tıpkı zarları atmadan önce taşları üst üste dizerken yapılan kesme işlemi.
  for (let k = 0; k < 3; k++) {
    const cut = Math.floor(Math.random() * (n - 20)) + 10;
    const top = shuffled.splice(0, cut);
    shuffled.push(...top);
  }

  return shuffled;
}

export function initializeGame(roundNumber: number, existingScores?: Record<string, number>): GameState {
  let deck = shuffleDeck(generateDeck());
  
  const indicator = deck.pop()!;
  
  const okeyValue = indicator.value === 13 ? 1 : indicator.value + 1;


  // Mark the actual Okey tiles in the deck
  for (const tile of deck) {
    if (tile.color === indicator.color && tile.value === okeyValue && !tile.isFalseOkey) {
      tile.isOkey = true;
    }
  }

  const turnOrder = ['player1', 'player4', 'player3', 'player2'];
  const startingPlayerIndex = (roundNumber - 1) % 4;
  const startingPlayerId = turnOrder[startingPlayerIndex];

  const distributeTiles = (deck: TileData[]) => {
    const players: any = {
      player1: { id: 'player1', name: 'Player 1', rack: [] as RackSlot[], score: existingScores ? (existingScores['player1'] || 0) : 0 },
      player2: { id: 'player2', name: 'Player 2', rack: [] as RackSlot[], score: existingScores ? (existingScores['player2'] || 0) : 0 },
      player3: { id: 'player3', name: 'Player 3', rack: [] as RackSlot[], score: existingScores ? (existingScores['player3'] || 0) : 0 },
      player4: { id: 'player4', name: 'Player 4', rack: [] as RackSlot[], score: existingScores ? (existingScores['player4'] || 0) : 0 },
    };

    const p1Tiles = deck.splice(0, startingPlayerId === 'player1' ? 22 : 21);
    const b1Tiles = deck.splice(0, startingPlayerId === 'player2' ? 22 : 21);
    const b2Tiles = deck.splice(0, startingPlayerId === 'player3' ? 22 : 21);
    const b3Tiles = deck.splice(0, startingPlayerId === 'player4' ? 22 : 21);

    const createRackSlots = (tiles: TileData[], prefix: string): RackSlot[] => {
      const slots: RackSlot[] = [];
      for (let i = 0; i < 32; i++) slots.push({ id: `${prefix}-slot-${i}`, tile: null });
      
      let tileIndex = 0;
      let slotIndex = 0;
      
      while (tileIndex < tiles.length && slotIndex < 32) {
        const blockSize = Math.floor(Math.random() * 3) + 4; 
        for (let b = 0; b < blockSize && tileIndex < tiles.length && slotIndex < 32; b++) {
          slots[slotIndex].tile = tiles[tileIndex];
          tileIndex++;
          slotIndex++;
        }
        slotIndex += Math.floor(Math.random() * 2) + 1;
      }
      
      while(tileIndex < tiles.length) {
         const emptyIndex = slots.findIndex(s => s.tile === null);
         if(emptyIndex !== -1) slots[emptyIndex].tile = tiles[tileIndex];
         tileIndex++;
      }

      return slots;
    };

    players.player1.rack = createRackSlots(p1Tiles, 'p1');
    players.player2.rack = createRackSlots(b1Tiles, 'p2');
    players.player3.rack = createRackSlots(b2Tiles, 'p3');
    players.player4.rack = createRackSlots(b3Tiles, 'p4');

    return { players, remainingDeck: deck };
  };

  const { players, remainingDeck } = distributeTiles(deck);

  const discardPiles: Record<string, TileData[]> = {
    player1: [],
    player2: [],
    player3: [],
    player4: [],
  };

  return {
    deck: remainingDeck,
    indicator,
    players,
    tableMelds: [],
    currentPlayerId: startingPlayerId,
    hasDrawn: true, // Starting player already has 22 tiles, so they "have drawn"
    hasOpenedHand: { player1: false, player2: false, player3: false, player4: false },
    discardPiles,
    tiles: [],
    highestSeriesPoint: 100,  // Katlamalı mod: ilk hedef 101 (100 + 1)
    highestPairsPoint: 4,     // Katlamalı mod: ilk hedef 5 (4 + 1)
    turnStartTime: 0,
  };
}
