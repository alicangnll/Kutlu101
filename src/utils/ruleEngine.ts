import type { TileData, RackSlot } from '../types';

export interface BlockValidationResult {
  isValid: boolean;
  type: 'run' | 'group' | 'pair' | 'invalid';
  points: number;
}

export interface RackPointsResult {
  totalSeriesPoints: number;
  totalPairs: number;
  isValidSeriesOpening: boolean; // >= 101 points
  isValidPairsOpening: boolean;  // >= 5 pairs
  validBlocks: TileData[][];
  invalidBlocks: TileData[][];
}

export const getRackBlocks = (rack: RackSlot[]): TileData[][] => {
  const blocks: TileData[][] = [];

  const extractBlocksFromRow = (rowSlots: RackSlot[]) => {
    let currentBlock: TileData[] = [];

    for (const slot of rowSlots) {
      if (slot.tile !== null) {
        currentBlock.push(slot.tile);
      } else {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }
  };

  extractBlocksFromRow(rack.slice(0, 16));
  extractBlocksFromRow(rack.slice(16, 32));

  return blocks;
};

/**
 * Okey 101 kurallarına göre blok validasyonu
 * Seri: 3+ taş, aynı renk, ardışık sayılar. Puan = ortası + yan taşlar/3
 * Grup: 3-4 taş, aynı sayı, farklı renkler. Puan = ortası + yan taşlar/3
 * Çift: 2 taş, aynı sayı, aynı renk. Puan = 0
 */
export const validateBlock = (block: TileData[]): BlockValidationResult => {
  if (block.length < 2) return { isValid: false, type: 'invalid', points: 0 };

  // Çift kontrolü (2 taş)
  if (block.length === 2) {
    const [t1, t2] = block;
    let isPair = false;
    if (t1.isOkey || t2.isOkey) {
        // Okey herhangi bir çift yerine geçebilir
        isPair = true;
    } else if (t1.value === t2.value && t1.color === t2.color && t1.isFalseOkey === t2.isFalseOkey) {
        isPair = true;
    }
    if (isPair) return { isValid: true, type: 'pair', points: 0 };
    return { isValid: false, type: 'invalid', points: 0 };
  }

  const anchorIdx = block.findIndex(t => !t.isOkey);
  if (anchorIdx === -1) return { isValid: false, type: 'invalid', points: 0 };

  const anchorTile = block[anchorIdx];
  const anchorVal = anchorTile.value;
  const anchorColor = anchorTile.color;

  // Grup kontrolü (aynı sayı, farklı renkler, 3-4 taş)
  let isGroup = true;
  if (block.length > 4 || block.length < 3) {
    isGroup = false;
  } else {
    const usedColors = new Set<string>();
    for (const t of block) {
      if (t.isOkey) {
        // Okey herhangi bir renkte olabilir
        continue;
      } else {
        if (t.value !== anchorVal) {
           isGroup = false;
           break;
        }
        if (usedColors.has(t.color)) {
          isGroup = false;
          break;
        }
        usedColors.add(t.color);
      }
    }
  }

  // Seri kontrolü (aynı renk, ardışık sayılar, 3+ taş)
  let isRun = true;
  if (block.length < 3) {
    isRun = false;
  } else {
    for (let j = 0; j < block.length; j++) {
      const t = block[j];
      // Her taştan anchorIdx kadar uzaklık ekleyerek expected değer hesapla
      let expectedVal = anchorVal + (j - anchorIdx);

      // 13'den sonra 1'e döner (13-1-2 serisi gibi)
      if (expectedVal === 14) expectedVal = 1;
      if (expectedVal === 0) expectedVal = 13;

      if (expectedVal > 14 || expectedVal < 1) {
          isRun = false;
          break;
      }

      if (t.isOkey) {
          // Okey yerine geçeceği taşın değerini alır
          continue;
      } else {
          if (t.color !== anchorColor || t.value !== expectedVal) {
              isRun = false;
              break;
          }
      }
    }
  }

  // Puan hesaplama (Okey 101 kuralı: ortası + yan taşlar/3)
  let points = 0;

  if (isGroup) {
    // Grup: ortası + yan taşlar/3
    const middleIdx = Math.floor(block.length / 2);
    const middleTile = block[middleIdx];
    const middleVal = middleTile.isOkey ? anchorVal : middleTile.value;

    points = middleVal;
    // Yan taşların toplamı / 3
    for (let i = 0; i < block.length; i++) {
      if (i === middleIdx) continue;
      const t = block[i];
      const val = t.isOkey ? anchorVal : t.value;
      points += Math.floor(val / 3);
    }
    return { isValid: true, type: 'group', points };
  }

  if (isRun) {
    // Seri: ortası + yan taşlar/3
    const middleIdx = Math.floor(block.length / 2);
    const middleTile = block[middleIdx];

    // Ortadaki taşın değeri (Okey ise anchorVal, değilse kendi değeri)
    let middleVal: number;
    if (middleTile.isOkey) {
      // Okey'in yerine geçeceği değer
      let expectedVal = anchorVal + (middleIdx - anchorIdx);
      if (expectedVal === 14) expectedVal = 1;
      if (expectedVal === 0) expectedVal = 13;
      middleVal = expectedVal;
    } else {
      middleVal = middleTile.value;
    }

    points = middleVal;
    // Yan taşların toplamı / 3
    for (let i = 0; i < block.length; i++) {
      if (i === middleIdx) continue;
      const t = block[i];
      let val: number;
      if (t.isOkey) {
        let expectedVal = anchorVal + (i - anchorIdx);
        if (expectedVal === 14) expectedVal = 1;
        if (expectedVal === 0) expectedVal = 13;
        val = expectedVal;
      } else {
        val = t.value;
      }
      points += Math.floor(val / 3);
    }
    return { isValid: true, type: 'run', points };
  }

  return { isValid: false, type: 'invalid', points: 0 };
};

export const calculateRackPoints = (rack: RackSlot[]): RackPointsResult => {
  const blocks = getRackBlocks(rack);

  let totalSeriesPoints = 0;
  let totalPairs = 0;
  const validBlocks: TileData[][] = [];
  const invalidBlocks: TileData[][] = [];

  for (const block of blocks) {
    const res = validateBlock(block);
    if (res.isValid) {
      validBlocks.push(block);
      if (res.type === 'pair') {
        totalPairs++;
      } else {
        totalSeriesPoints += res.points;
      }
    } else {
      invalidBlocks.push(block);
    }
  }

  return {
    totalSeriesPoints,
    totalPairs,
    isValidSeriesOpening: totalSeriesPoints >= 101,
    isValidPairsOpening: totalPairs >= 5,
    validBlocks,
    invalidBlocks
  };
};

/**
 * Checks if a single tile can be appended to an existing meld on the table.
 * Returns the valid insert position ('start', 'end', 'any') or 'invalid'.
 */
export const canAppendToMeld = (meld: TileData[], tile: TileData): { valid: boolean, position: 'start' | 'end' | 'any' | 'invalid' } => {
  if (meld.length < 2) return { valid: false, position: 'invalid' };

  const res = validateBlock(meld);

  if (res.type === 'group') {
     const testGroup = [...meld, tile];
     if (validateBlock(testGroup).isValid) return { valid: true, position: 'any' };
     return { valid: false, position: 'invalid' };
  }

  if (res.type === 'run') {
    const testEnd = [...meld, tile];
    if (validateBlock(testEnd).isValid) return { valid: true, position: 'end' };

    const testStart = [tile, ...meld];
    if (validateBlock(testStart).isValid) return { valid: true, position: 'start' };

    return { valid: false, position: 'invalid' };
  }

  return { valid: false, position: 'invalid' };
};

/**
 * Checks if a tile is 'islek' (playable) on ANY of the current table melds.
 * Also returns true if the tile is Okey, because Okey is always 'islek'.
 */
export const isTilePlayable = (tableMelds: TileData[][], tile: TileData): boolean => {
  if (tile.isOkey) return true;
  for (const meld of tableMelds) {
    if (canAppendToMeld(meld, tile).valid) {
      return true;
    }
  }
  return false;
};
