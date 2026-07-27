import type { TileData, RackSlot } from '../types';
import { autoSortSeries, autoSortPairs } from './sortLogic';
import { calculateRackPoints, canAppendToMeld, isTilePlayable } from './ruleEngine';

interface MatchState {
  isKatlamali: boolean;
  highestSeriesPoint: number;
  highestPairsPoint: number;
}

export const playBotLogic = (
  rack: RackSlot[],
  tableMelds: TileData[][],
  hasOpened: boolean,
  matchState: MatchState
): {
  newRack: RackSlot[];
  newTableMelds: TileData[][];
  hasOpenedNow: boolean;
  openedSeries: boolean;
  openedPairs: boolean;
} => {
  let currentRack = [...rack];
  let currentMelds = [...tableMelds];
  let openedNow = hasOpened;
  let openedSeries = false;
  let openedPairs = false;

  if (openedNow) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < currentRack.length; i++) {
        const slot = currentRack[i];
        if (!slot.tile) continue;
        for (let m = 0; m < currentMelds.length; m++) {
          const appendCheck = canAppendToMeld(currentMelds[m], slot.tile);
          if (appendCheck.valid) {
            if (appendCheck.position === 'start') {
              currentMelds[m] = [slot.tile, ...currentMelds[m]];
            } else {
              currentMelds[m] = [...currentMelds[m], slot.tile];
            }
            currentRack[i] = { ...currentRack[i], tile: null };
            changed = true;
            break;
          }
        }
      }
    }
  }

  if (!openedNow) {
    let sortedRack = autoSortSeries(currentRack);
    let pointsInfo = calculateRackPoints(sortedRack);

    const targetSeries = matchState.isKatlamali ? matchState.highestSeriesPoint + 1 : 101;
    const targetPairs = matchState.isKatlamali ? matchState.highestPairsPoint + 1 : 5;

    if (pointsInfo.isValidSeriesOpening && pointsInfo.totalSeriesPoints >= targetSeries) {
      openedNow = true;
      openedSeries = true;
      for (const block of pointsInfo.validBlocks) {
        currentMelds.push(block);
        for (const tile of block) {
          const s = sortedRack.find(s => s.tile?.id === tile.id);
          if (s) s.tile = null;
        }
      }
      currentRack = sortedRack;
    } else {
      sortedRack = autoSortPairs(currentRack);
      pointsInfo = calculateRackPoints(sortedRack);
      if (pointsInfo.isValidPairsOpening && pointsInfo.totalPairs >= targetPairs) {
        openedNow = true;
        openedPairs = true;
        for (const block of pointsInfo.validBlocks) {
          currentMelds.push(block);
          for (const tile of block) {
            const s = sortedRack.find(s => s.tile?.id === tile.id);
            if (s) s.tile = null;
          }
        }
        currentRack = sortedRack;
      }
    }

    if (openedNow && !hasOpened) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < currentRack.length; i++) {
          const slot = currentRack[i];
          if (!slot.tile) continue;
          for (let m = 0; m < currentMelds.length; m++) {
            const appendCheck = canAppendToMeld(currentMelds[m], slot.tile);
            if (appendCheck.valid) {
              if (appendCheck.position === 'start') {
                currentMelds[m] = [slot.tile, ...currentMelds[m]];
              } else {
                currentMelds[m] = [...currentMelds[m], slot.tile];
              }
              currentRack[i] = { ...currentRack[i], tile: null };
              changed = true;
              break;
            }
          }
        }
      }
    }
  }

  currentRack = autoSortSeries(currentRack);
  return { newRack: currentRack, newTableMelds: currentMelds, hasOpenedNow: openedNow, openedSeries, openedPairs };
};

export const getBotDiscardDecision = (
  rack: RackSlot[],
  tableMelds: TileData[][],
  settings: { islekCezasi: boolean; okeyCezasi: boolean }
): TileData => {
  const occupiedSlots = rack.filter(s => s.tile !== null);
  let pool = occupiedSlots;

  // İşlek atma cezası varsa, işlek taşları atlamayı dene
  if (settings.islekCezasi) {
    const nonIslekSlots = occupiedSlots.filter(s => !isTilePlayable(tableMelds, s.tile!));
    pool = nonIslekSlots.length > 0 ? nonIslekSlots : occupiedSlots;
  }

  // Yere Okey atma cezası varsa, Okey taşlarını atlamayı dene
  if (settings.okeyCezasi) {
    const nonOkeySlots = pool.filter(s => !s.tile!.isOkey);
    pool = nonOkeySlots.length > 0 ? nonOkeySlots : pool;
  }

  pool.sort((a, b) => b.tile!.value - a.tile!.value);
  return pool[0].tile!;
};
