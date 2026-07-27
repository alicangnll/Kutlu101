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

export function initializeGame(currentRound: number = 1): GameState {
  let deck = shuffleDeck(generateDeck());
  
  const indicator = deck.pop()!;
  
  const okeyValue = indicator.value === 13 ? 1 : indicator.value + 1;


  // Mark the actual Okey tiles in the deck
  for (const tile of deck) {
    if (tile.color === indicator.color && tile.value === okeyValue && !tile.isFalseOkey) {
      tile.isOkey = true;
    }
  }

  const turnOrder = ['player1', 'bot3', 'bot2', 'bot1'];
  const startingPlayerIndex = (currentRound - 1) % 4;
  const startingPlayerId = turnOrder[startingPlayerIndex];

  const distributeTiles = (deck: TileData[]) => {
    const players = {
      player1: { id: 'player1', name: 'Sen', rack: [] as RackSlot[], openedSets: [], openedPairs: [], score: 0 },
      bot1: { id: 'bot1', name: 'Bot 1', rack: [] as RackSlot[], openedSets: [], openedPairs: [], score: 0 },
      bot2: { id: 'bot2', name: 'Bot 2', rack: [] as RackSlot[], openedSets: [], openedPairs: [], score: 0 },
      bot3: { id: 'bot3', name: 'Bot 3', rack: [] as RackSlot[], openedSets: [], openedPairs: [], score: 0 },
    };

    const p1Tiles = deck.splice(0, startingPlayerId === 'player1' ? 22 : 21);
    const b1Tiles = deck.splice(0, startingPlayerId === 'bot1' ? 22 : 21);
    const b2Tiles = deck.splice(0, startingPlayerId === 'bot2' ? 22 : 21);
    const b3Tiles = deck.splice(0, startingPlayerId === 'bot3' ? 22 : 21);

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
    players.bot1.rack = createRackSlots(b1Tiles, 'b1');
    players.bot2.rack = createRackSlots(b2Tiles, 'b2');
    players.bot3.rack = createRackSlots(b3Tiles, 'b3');

    return { players, remainingDeck: deck };
  };

  const { players, remainingDeck } = distributeTiles(deck);

  const discardPiles: Record<string, TileData[]> = {
    player1: [],
    bot1: [],
    bot2: [],
    bot3: [],
  };

  return {
    deck: remainingDeck,
    indicator,
    players,
    tableMelds: [],
    currentPlayerId: startingPlayerId,
    hasDrawn: false,
    hasOpenedHand: { player1: false, bot1: false, bot2: false, bot3: false },
    discardPiles,
    tiles: [],
    highestSeriesPoint: 100,  // Katlamalı mod: ilk hedef 101 (100 + 1)
    highestPairsPoint: 4,     // Katlamalı mod: ilk hedef 5 (4 + 1)
    turnStartTime: 0
  };
}
