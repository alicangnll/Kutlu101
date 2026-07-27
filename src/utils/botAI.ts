import type { TileData, MatchState, RackSlot } from '../types';
import { autoSortSeries, autoSortPairs } from './sortLogic';
import { calculateRackPoints, canAppendToMeld, isTilePlayable } from './ruleEngine';

// Bot zorluk seviyesi (0.0 - 1.0 arası, ne kadar düşük o kadar zor)
const BOT_DIFFICULTY = 0.6; // Botların %60 ihtimalle doğru hamle yapması

export const playBotLogic = (
  botId: string,
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

  // 1. Try to append to existing melds if already opened
  if (openedNow) {
    // Bot bazen hata yapabilir - her zaman eklemeye çalışmaz
    const shouldPlay = Math.random() < BOT_DIFFICULTY;

    if (shouldPlay) {
      let changed = true;
      // Sadece birkaç taş eklemeye çalış (hepsini değil)
      let maxAdditions = Math.floor(Math.random() * 3) + 1; // 1-3 taş ekle
      let additions = 0;

      while (changed && additions < maxAdditions) {
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
              additions++;
              break;
            }
          }
          if (additions >= maxAdditions) break;
        }
      }
    }
  }

  // 2. If not opened, sort and check if can open
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
      // El açtıktan sonra sadece birkaç taş eklemeye çalışsın
      const shouldAppend = Math.random() < BOT_DIFFICULTY;
      if (shouldAppend) {
        let changed = true;
        let maxAdditions = Math.floor(Math.random() * 2) + 1; // 1-2 taş ekle
        let additions = 0;

        while (changed && additions < maxAdditions) {
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
                additions++;
                break;
              }
            }
            if (additions >= maxAdditions) break;
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
