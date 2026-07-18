/**
 * Bot with Dashboard - Wrapper that runs the bot with real-time monitoring UI
 * 
 * This file shows HOW to integrate the dashboard with your bot.
 * It imports the dashboard and hooks into the bot's state/logs.
 * 
 * Run with: npx tsx bot-with-dashboard.ts
 * Then open: http://localhost:5173
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import {
  PolymarketSDK,
  ArbitrageService,
  SwapService,
  type SmartMoneyTrade,
  OnchainService,
} from './src/index.js';
import { CTFClient } from './src/clients/ctf-client.js';
import { startDashboard, dashboardEmitter } from './src/dashboard/index.js';
import type { BotState, BotConfig, LogLevel, DipArbSignal, SmartMoneySignal } from './src/dashboard/types.js';
import { addSession, createSessionFromState, type TradeRecord } from './src/dashboard/session-history.js';
import { Telegraf } from 'telegraf';
import { TradingService } from './src/services/trading-service.js';

// ============================================================================
// TELEGRAM NOTIFICATION SYSTEM
// ============================================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const telegramBot = TELEGRAM_BOT_TOKEN ? new Telegraf(TELEGRAM_BOT_TOKEN) : null;

// Telegram rate limiting: en az 3 saniye aralıkla mesaj gönder
let lastTelegramTime = 0;
const TELEGRAM_COOLDOWN_MS = 3000;
const telegramQueue: Array<{ message: string; resolve: () => void }> = [];
let telegramProcessing = false;

async function processTelegramQueue() {
  if (telegramProcessing || telegramQueue.length === 0) return;
  telegramProcessing = true;

  while (telegramQueue.length > 0) {
    const now = Date.now();
    const wait = TELEGRAM_COOLDOWN_MS - (now - lastTelegramTime);
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }

    const item = telegramQueue.shift()!;
    if (telegramBot && TELEGRAM_CHAT_ID) {
      try {
        await telegramBot.telegram.sendMessage(TELEGRAM_CHAT_ID, item.message, { parse_mode: 'HTML' });
        lastTelegramTime = Date.now();
      } catch (err) {
        const errMsg = (err as Error).message;
        if (errMsg.includes('429')) {
          // Rate limited - bekle ve tekrar dene
          const retryAfter = parseInt(errMsg.match(/retry after (\d+)/)?.[1] || '5') * 1000;
          await new Promise(r => setTimeout(r, retryAfter));
          telegramQueue.unshift(item); // Başa ekle
        } else {
          console.error(`[Telegram] Error: ${errMsg}`);
        }
      }
    }
    item.resolve();
  }
  telegramProcessing = false;
}

function sendTelegram(message: string) {
  if (!telegramBot || !TELEGRAM_CHAT_ID) return;
  return new Promise<void>(resolve => {
    telegramQueue.push({ message, resolve });
    processTelegramQueue();
  });
}

function notifyTradeOpen(side: string, market: string, size: number, price: number, wallet: string) {
  const emoji = side === 'BUY' ? '🟢' : '🔴';
  const msg = `${emoji} <b>İŞLEM AÇILDI</b>\n\n` +
    `📊 Piyasa: ${market}\n` +
    `📈 Yön: ${side}\n` +
    `💰 Tutar: $${size.toFixed(2)}\n` +
    `💲 Fiyat: $${price.toFixed(4)}\n` +
    `👛 Kaynak: ${wallet.slice(0, 10)}...`;
  sendTelegram(msg);
}

function notifyTradeClose(side: string, market: string, size: number, price: number, profit: number) {
  const emoji = profit >= 0 ? '✅' : '❌';
  const profitEmoji = profit >= 0 ? '+' : '';
  const msg = `${emoji} <b>İŞLEM KAPANDI</b>\n\n` +
    `📊 Piyasa: ${market}\n` +
    `📈 Yön: ${side}\n` +
    `💰 Tutar: $${size.toFixed(2)}\n` +
    `💲 Fiyat: $${price.toFixed(4)}\n` +
    `📊 Kâr/Zarar: ${profitEmoji}$${profit.toFixed(2)}`;
  sendTelegram(msg);
}

// ============================================================================
// CONFIGURATION (same as bot-config.ts)
// ============================================================================

let CONFIG = {
  capital: {
    totalUsd: parseFloat(process.env.CAPITAL_USD || '250'),
    maxPerTradePct: 0.02,  // 🔴 FIXED: Reduced from 3% to 2%
    maxPerMarketPct: 0.10,
    maxTotalExposurePct: 0.30,
    minOrderUsd: 1,
    strategyAllocation: {
      smartMoney: 0.60,
      arbitrage: 0.20,
      dipArb: 0.10,
      directTrades: 0.10,
    },
  },

  risk: {
    // Daily limits
    dailyMaxLossPct: 0.05,  // 🔴 FIXED: Reduced from 8% to 5%
    maxConsecutiveLosses: 6,
    pauseOnBreachMinutes: 60,

    // 🔴 NEW: v3.1 Multi-layer protection
    monthlyMaxLossPct: 0.15,  // 15% monthly limit
    maxDrawdownFromPeak: 0.25,  // 25% drawdown from peak
    totalMaxLossPct: 0.40,  // 40% total loss - permanent halt

    // 🔴 NEW: Dynamic position sizing
    enableDynamicSizing: true,
    minPositionPct: 0.01,  // 1% minimum
    maxPositionPct: 0.05,  // 5% maximum
    lossSizingReduction: 0.20,  // Reduce 20% per loss
    winSizingIncrease: 0.10,  // Increase 10% per win
  },

  smartMoney: {
    enabled: process.env.SMARTMONEY_ENABLED !== 'false',
    topN: 0,  // Leaderboard izlemeyi kapat - sadece custom wallet takip et
    minWinRate: 0.60,
    minPnl: 500,
    minTrades: 30,

    minProfitFactor: 1.5,
    minConsistencyScore: 0.7,
    maxSingleTradeExposure: 0.3,
    checkLastNTrades: 10,

    sizeScale: 0.1,
    maxSizePerTrade: 5,  // Fee buffer ile guvenli max
    maxSlippage: 0.05,
    minTradeSize: 1,
    delay: 100,  // Hizli kopyalama icin dusuk gecikme
    customWallets: [
      '0x6ff2cb14da8be7eb57541d250a0196c5f295f140',  // Avrupa sicaklik trader - disiplinli strateji
    ] as string[],
  },

  // Erken cikis stratejisi - kucuk butce, istikrarli kar odakli
  earlyExit: {
    enabled: true,
    profitTarget1: 0.20,   // +%20 karda yarisini sat (hizli kar kilitle)
    profitTarget2: 0.50,   // +%50 karda kalanini sat
    sellAtTarget1: 0.50,   // Target1'de pozisyonun %50'sini sat
    stopLossPct: 0.30,     // -%30 zararda cik (sermaye koruma)
    maxHoldMinutes: 360,   // Maksimum 6 saat bekle (hava marketleri kisa omurlu)
    checkIntervalMs: 10000, // Her 10 saniyede kontrol et (daha hassas)
  },

  arbitrage: {
    enabled: process.env.ARBITRAGE_ENABLED === 'true',
    // 🔴 FIXED: Higher profit threshold for gas fees
    profitThreshold: 0.01,  // Up from 0.001 to 1%
    minTradeSize: 20,  // Up from 5 to reduce gas impact
    maxTradeSize: 100,  // Up from 50
    minVolume24h: 5000,
    autoExecute: true,
    enableRebalancer: true,

    // 🔴 NEW: Gas fee accounting
    estimatedGasCostUSD: 0.10,
    minNetProfit: 0.50,
  },

  dipArb: {
    enabled: process.env.DIPARB_ENABLED === 'true',
    coins: ['BTC', 'ETH', 'SOL'] as const,
    shares: 10,
    sumTarget: 0.92,
    autoRotate: true,
    autoExecute: true,
    // 🔴 NEW: Minimum trade value
    minTradeValueUSD: 1.5,  // $1.50 minimum
  },

  onchain: {
    enabled: true,
    autoApprove: true,
    minMatic: 0.5,
  },

  binance: {
    enabled: process.env.TREND_ANALYSIS_ENABLED === 'true',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const,
    interval: '15m' as const,
    trendThreshold: 2,
  },

  directTrading: {
    enabled: false,
    trendFollowing: true,
    minTrendStrength: 0.02,
    // 🔴 NEW: Stop-loss and take-profit
    stopLossPct: 0.15,
    takeProfitPct: 0.25,
    trailingStopPct: 0.10,
    maxHoldDays: 7,
    minRiskReward: 1.5,
  },

  dryRun: process.env.DRY_RUN !== 'false',
};

// ============================================================================
// STATE
// ============================================================================

const state: BotState = {
  startTime: Date.now(),
  dailyPnL: 0,
  totalPnL: 0,
  consecutiveLosses: 0,
  consecutiveWins: 0,  // 🔴 NEW
  tradesExecuted: 0,
  isPaused: false,
  pauseUntil: 0,

  // 🔴 NEW: v3.1 Risk tracking
  monthlyPnL: 0,
  monthStartTime: Date.now(),
  peakCapital: CONFIG.capital.totalUsd,
  currentCapital: CONFIG.capital.totalUsd,
  currentDrawdown: 0,
  permanentlyHalted: false,
  lastDailyReset: Date.now(),

  smartMoneyTrades: 0,
  arbTrades: 0,
  dipArbTrades: 0,
  directTrades: 0,
  arbProfit: 0,
  followedWallets: [],
  positions: [],
  activeArbMarket: null,
  activeDipArbMarket: null,
  splits: 0,
  merges: 0,
  redeems: 0,
  swaps: 0,
  usdcBalance: 0,
  usdcEBalance: 0,
  maticBalance: 0,
  unrealizedPnL: 0,
  btcTrend: 'neutral',
  ethTrend: 'neutral',
  solTrend: 'neutral',

  dipArb: {
    marketName: null,
    underlying: null,
    duration: null,
    endTime: null,
    upPrice: 0,
    downPrice: 0,
    sum: 0,
    status: 'idle',
    lastSignal: null,
    signals: [],
  },

  arbitrage: {
    status: 'idle',
    marketsScanned: 0,
    opportunitiesFound: 0,
    currentMarket: null,
    lastOpportunity: null,
  },

  smartMoneySignals: [],

  // Early exit tracker - kopyalanan pozisyonlar icin cikis takibi
  earlyExitTracker: new Map<string, {
    entryPrice: number;
    entrySize: number;
    remainingSize: number;
    firstSellDone: boolean;
    marketSlug: string;
    entryTime: number;
  }>(),
};

// ============================================================================
// DASHBOARD-AWARE UTILITIES
// ============================================================================

function log(level: LogLevel, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const icons: Record<string, string> = {
    INFO: '📋', WARN: '⚠️', ERROR: '❌', TRADE: '💰', SIGNAL: '🎯',
    ARB: '🔄', WALLET: '👛', CHAIN: '⛓️', SWAP: '💱', BRIDGE: '🌉',
    KLINE: '📊', TREND: '📈',
  };

  // Console output (CLI)
  console.log(`[${timestamp}] ${icons[level] || '•'} ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));

  // Dashboard output (WebSocket)
  dashboardEmitter.log(level, message, data);
}

function updateDashboard() {
  dashboardEmitter.updateState(state);
}

// 🔴 FIXED: v3.1 Multi-layer risk management
function canTrade(): boolean {
  // Check if permanently halted
  if (state.permanentlyHalted) {
    log('ERROR', '🛑 Trading permanently halted - total loss limit reached');
    return false;
  }

  // Reset daily PnL if new day
  const daysSinceReset = (Date.now() - state.lastDailyReset) / (1000 * 60 * 60 * 24);
  if (daysSinceReset >= 1) {
    log('INFO', `Daily PnL reset. Previous day: $${state.dailyPnL.toFixed(2)}`);
    state.dailyPnL = 0;
    state.lastDailyReset = Date.now();
  }

  // Reset monthly PnL if new month
  const daysSinceMonthStart = (Date.now() - state.monthStartTime) / (1000 * 60 * 60 * 24);
  if (daysSinceMonthStart >= 30) {
    log('INFO', `Monthly PnL reset. Previous month: $${state.monthlyPnL.toFixed(2)}`);
    state.monthlyPnL = 0;
    state.monthStartTime = Date.now();
  }

  // Update current capital and drawdown
  state.currentCapital = CONFIG.capital.totalUsd + state.totalPnL;
  if (state.currentCapital > state.peakCapital) {
    state.peakCapital = state.currentCapital;
  }
  state.currentDrawdown = (state.peakCapital - state.currentCapital) / state.peakCapital;

  // Check temporary pause
  if (state.isPaused && Date.now() < state.pauseUntil) return false;
  if (state.isPaused && Date.now() >= state.pauseUntil) {
    state.isPaused = false;
    log('INFO', 'Bot resumed after cooldown');
    updateDashboard();
  }

  // Layer 1: Daily loss limit
  const dailyLossLimit = CONFIG.capital.totalUsd * CONFIG.risk.dailyMaxLossPct;
  if (state.dailyPnL <= -dailyLossLimit) {
    state.isPaused = true;
    state.pauseUntil = Date.now() + CONFIG.risk.pauseOnBreachMinutes * 60 * 1000;
    log('WARN', `Daily loss limit breached: -$${Math.abs(state.dailyPnL).toFixed(2)} (limit: $${dailyLossLimit.toFixed(2)})`);
    updateDashboard();
    return false;
  }

  // Layer 2: Monthly loss limit
  const monthlyLossLimit = CONFIG.capital.totalUsd * CONFIG.risk.monthlyMaxLossPct;
  if (state.monthlyPnL <= -monthlyLossLimit) {
    log('ERROR', `🛑 Monthly loss limit breached: -$${Math.abs(state.monthlyPnL).toFixed(2)} (limit: $${monthlyLossLimit.toFixed(2)})`);
    state.isPaused = true;
    state.pauseUntil = Date.now() + (30 * 24 * 60 * 60 * 1000);
    updateDashboard();
    return false;
  }

  // Layer 3: Drawdown from peak
  if (state.currentDrawdown >= CONFIG.risk.maxDrawdownFromPeak) {
    log('ERROR', `🛑 Maximum drawdown reached: ${(state.currentDrawdown * 100).toFixed(1)}%`);
    state.isPaused = true;
    state.pauseUntil = Date.now() + (7 * 24 * 60 * 60 * 1000);
    updateDashboard();
    return false;
  }

  // Layer 4: Total loss - PERMANENT HALT
  const totalLossLimit = CONFIG.capital.totalUsd * CONFIG.risk.totalMaxLossPct;
  if (state.totalPnL <= -totalLossLimit) {
    state.permanentlyHalted = true;
    log('ERROR', '💀 TOTAL LOSS LIMIT REACHED - TRADING PERMANENTLY HALTED');
    log('ERROR', `Total loss: -$${Math.abs(state.totalPnL).toFixed(2)} (limit: $${totalLossLimit.toFixed(2)})`);
    updateDashboard();
    return false;
  }

  return true;
}

// 🔴 FIXED: Enhanced trade recording with win tracking
function recordTrade(profit: number, strategy: string) {
  state.tradesExecuted++;
  state.dailyPnL += profit;
  state.monthlyPnL += profit;  // NEW
  state.totalPnL += profit;

  // Track consecutive wins/losses
  if (profit < 0) {
    state.consecutiveLosses++;
    state.consecutiveWins = 0;
  } else {
    state.consecutiveLosses = 0;
    state.consecutiveWins++;
  }

  if (strategy === 'smartMoney') state.smartMoneyTrades++;
  else if (strategy === 'arbitrage') state.arbTrades++;
  else if (strategy === 'dipArb') state.dipArbTrades++;
  else if (strategy === 'direct') state.directTrades++;

  updateDashboard();
}

function simulateTrade(profit: number, strategy: string, description: string) {
  if (!CONFIG.dryRun || !state.paper) return;

  state.paper.trades++;
  state.paper.pnl += profit;
  state.paper.balance += profit;

  // Log as a special SIMULATION event
  log('TRADE', `[SIMULATION] ${description} | Est. Profit: $${profit.toFixed(2)}`);

  // Update main PnL so the user sees movement on the dashboard (as requested)
  recordTrade(profit, strategy);
}

// ============================================================================
// ============================================================================
// STRATEGIES (simplified versions - copy full implementations from bot-config.ts)
// ============================================================================

let arbService: ArbitrageService | null = null;
let sdkInstance: PolymarketSDK | null = null;
let tradingService: TradingService | null = null;
let isSmartMoneyInitialized = false;
let isSmartMoneyInitializing = false;

// Throttle: en fazla 3 saniyede bir işlem aç
const TRADE_COOLDOWN_MS = 3000;
let lastTradeTime = 0;
let pendingTrade = false;

async function setupSmartMoney(sdk: PolymarketSDK) {
  if (CONFIG.smartMoney.enabled) {
    initializeSmartMoney(sdk);
  }
}

async function initializeSmartMoney(sdk: PolymarketSDK) {
  if (isSmartMoneyInitialized || isSmartMoneyInitializing) return;
  isSmartMoneyInitializing = true;

  log('WALLET', 'Setting up Smart Money with quality filtering...');

  const qualified: string[] = [];

  if (CONFIG.smartMoney.customWallets?.length > 0) {
    for (const wallet of CONFIG.smartMoney.customWallets) {
      qualified.push(wallet);
      log('WALLET', `⭐ Custom wallet added: ${wallet.slice(0, 10)}...`);
    }
  }

  try {
    const leaderboard = await sdk.wallets.getLeaderboardByPeriod('week', CONFIG.smartMoney.topN * 2, 'pnl');

    for (const entry of leaderboard) {
      // Check if disabled mid-process to abort early
      if (!CONFIG.smartMoney.enabled && qualified.length === 0) break;

      if (qualified.length >= 10) break; // User limit: Max 10 qualified wallets
      if (qualified.includes(entry.address)) continue;

      const profile = await sdk.wallets.getWalletProfile(entry.address);
      if (!profile) continue;

      const winRate = (profile as any).winRate ?? 0;
      const pnl = entry.pnl ?? 0;
      const trades = profile.tradeCount ?? 0;

      if (winRate >= CONFIG.smartMoney.minWinRate &&
        pnl >= CONFIG.smartMoney.minPnl &&
        trades >= CONFIG.smartMoney.minTrades) {
        qualified.push(entry.address);
        log('WALLET', `✅ Qualified: ${entry.address.slice(0, 10)}... (WR:${(winRate * 100).toFixed(0)}% PnL:$${pnl.toFixed(0)} T:${trades})`);
      }

      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    log('WARN', `Leaderboard error: ${(err as Error).message}`);
  }

  state.followedWallets = qualified;
  log('WALLET', `Following ${qualified.length} wallets`);
  updateDashboard();

  if (qualified.length > 0) {
    // Subscribe to smart money trades with address filter
    sdk.smartMoney.subscribeSmartMoneyTrades(
      async (trade: SmartMoneyTrade) => {
        if (!CONFIG.smartMoney.enabled) return;
        if (!canTrade()) return;

        // HAVA DURUMU FILTRESI - Sadece hava durumu piyasalarini kopyala
        const marketSlug = (trade.marketSlug || '').toLowerCase();
        const isWeatherMarket = marketSlug.includes('temperature') ||
          marketSlug.includes('weather') ||
          marketSlug.includes('highest') ||
          marketSlug.includes('lowest') ||
          marketSlug.includes('celsius') ||
          marketSlug.includes('fahrenhe') ||
          marketSlug.includes('london') ||
          marketSlug.includes('hong-kong') ||
          marketSlug.includes('paris') ||
          marketSlug.includes('shenzhen') ||
          marketSlug.includes('guangzhou') ||
          marketSlug.includes('munich') ||
          marketSlug.includes('tokyo') ||
          marketSlug.includes('new-york') ||
          marketSlug.includes('amsterdam') ||
          marketSlug.includes('chicago') ||
          marketSlug.includes('madrid') ||
          marketSlug.includes('taipei');

        if (!isWeatherMarket) {
          // Hava durumu degil, atla
          return;
        }

        // Sadece ucuz alimlari kopyala ($0.20 altinda) - hedge bahislerini atla
        if (trade.side === 'BUY' && trade.price > 0.20) {
          log('WARN', `Pahali alim atlandi: $${trade.price.toFixed(2)} - ${trade.marketSlug}`);
          return;
        }

        // GECMIS PIYASALARI FILTRELE - sadece gelecekteki piyasalar
        const dateMatch = marketSlug.match(/on-(\w+)-(\d+)-(\d{4})/);
        if (dateMatch) {
          const monthMap: Record<string, number> = {
            'january': 0, 'february': 1, 'march': 2, 'april': 3,
            'may': 4, 'june': 5, 'july': 6, 'august': 7,
            'september': 8, 'october': 9, 'november': 10, 'december': 11,
          };
          const month = monthMap[dateMatch[1].toLowerCase()];
          const day = parseInt(dateMatch[2]);
          const year = parseInt(dateMatch[3]);

          if (month !== undefined) {
            const marketDate = new Date(year, month, day, 23, 59, 59);
            if (marketDate < new Date()) {
              log('WARN', `Gecmis piyasa atlandi: ${trade.marketSlug}`);
              return;
            }
          }
        }

        // ... (inside setupSmartMoney callback)
        // Add to smart money signals for dashboard
        const signal: SmartMoneySignal = {
          id: `sm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          wallet: trade.traderAddress,
          market: trade.marketSlug || 'Unknown',
          side: trade.side as 'BUY' | 'SELL',
          size: trade.size,
          price: trade.price,
        };
        state.smartMoneySignals.unshift(signal);
        if (state.smartMoneySignals.length > 50) {
          state.smartMoneySignals = state.smartMoneySignals.slice(0, 50);
        }

        log('SIGNAL', `Copy trade signal from ${trade.traderAddress.slice(0, 10)}...`, {
          market: trade.marketSlug?.slice(0, 50),
          side: trade.side,
          size: trade.size,
          price: trade.price,
        });
        updateDashboard();

        // EXECUTION LOGIC
        if (CONFIG.dryRun) {
          simulateTrade(0, 'smartMoney', `Smart Money Copy: ${trade.side} ${trade.size} shares @ ${trade.price}`);
        } else {
          // GERCEK ISLEM - Throttle ile
          // HEMEN kilitle (race condition engeli)
          if (pendingTrade) {
            log('WARN', `Pending trade var, atlanıyor`);
            return;
          }
          pendingTrade = true;

          try {
            const sdk = sdkInstance;
            if (!sdk || !sdk.tradingService) {
              log('ERROR', 'TradingService not initialized');
              pendingTrade = false;
              return;
            }

            // THROTTLE: son işlemden beri 3 saniye geçti mi?
            const now = Date.now();
            if ((now - lastTradeTime) < TRADE_COOLDOWN_MS) {
              log('WARN', `Throttled - son işlemden beri ${(now - lastTradeTime)}ms geçti (min ${TRADE_COOLDOWN_MS}ms)`);
              pendingTrade = false;
              return;
            }

            // SELL sinyali - ERKEN CIKIS STRATEJISI: kendi cikis kurallarimizi kullaniyoruz
            if (trade.side === 'SELL') {
              log('SIGNAL', `SELL sinyali atlandi (erken cikis stratejisi aktif): ${trade.marketSlug}`);
              pendingTrade = false;
              return;
            }

            // Token ID'yi al (trade objesinden)
            const tokenId = trade.tokenId;
            if (!tokenId) {
              log('ERROR', 'No tokenId in trade signal');
              pendingTrade = false;
              return;
            }

            // Fiyat kontrolü
            if (!trade.price || trade.price <= 0 || trade.price >= 1) {
              log('WARN', `Invalid price: ${trade.price}`);
              pendingTrade = false;
              return;
            }

            // Bakiye kontrolü
            let balance = 0;
            try {
              const balResult = await sdk.tradingService.getBalanceAllowance('COLLATERAL');
              balance = parseFloat(balResult.balance) / 1e6;
              state.usdcBalance = balance;
            } catch {
              log('WARN', 'Balance check failed, proceeding anyway');
            }

            const maxUsd = CONFIG.smartMoney.maxSizePerTrade; // 10
            // ponytail: ~2% fee buffer — Polymarket taker fee
            const effectiveUsd = Math.min(balance > 0 ? balance * 0.96 : maxUsd, maxUsd);
            if (balance > 0 && balance < CONFIG.minOrderUsd) {
              log('WARN', `Yetersiz bakiye: $${balance.toFixed(2)} (min: $${CONFIG.minOrderUsd})`);
              pendingTrade = false;
              return;
            }

            // Hisseleri hesapla: effectiveUsd / fiyat = kaç hisse alınır
            // Polymarket minimum 5 hisse gerektirir
            let tradeSize = Math.floor(effectiveUsd / trade.price);
            if (tradeSize < 5) {
              log('WARN', `Trade size too small: ${tradeSize} shares (min 5). Price: $${trade.price}`);
              pendingTrade = false;
              return;
            }

            // Emir değerini kontrol et (min $1)
            const orderValue = tradeSize * trade.price;
            if (orderValue < 1) {
              log('WARN', `Order value too small: $${orderValue.toFixed(2)} (min $1)`);
              pendingTrade = false;
              return;
            }

            lastTradeTime = Date.now();

            log('TRADE', `Placing order: BUY ${tradeSize} shares @ $${trade.price} on ${trade.marketSlug} (value: $${orderValue.toFixed(2)})`);

            const result = await sdk.tradingService.createLimitOrder({
              tokenId: tokenId,
              side: 'BUY',
              price: trade.price,
              size: tradeSize,
              orderType: 'GTC',
            });

            pendingTrade = false;

            if (result.success) {
              log('TRADE', `Order placed successfully! ID: ${result.orderId}`);
              sendTelegram(`✅ <b>İŞLEM AÇILDI</b>\n\n📊 Market: ${trade.marketSlug}\n📈 Yön: BUY\n💰 Hisse: ${tradeSize}\n💲 Fiyat: $${trade.price}\n💵 Değer: $${orderValue.toFixed(2)}\n🎯 Erken çıkış aktif: %30/%50 kademeli`);
              recordTrade(0, 'smartMoney');

              // Early exit tracker'a kaydet
              if (CONFIG.earlyExit.enabled) {
                const existing = state.earlyExitTracker.get(tokenId);
                if (existing) {
                  // Ayni token'a daha once girildiyse, ortala
                  const totalSize = existing.remainingSize + tradeSize;
                  const avgPrice = ((existing.entryPrice * existing.remainingSize) + (trade.price * tradeSize)) / totalSize;
                  existing.entryPrice = avgPrice;
                  existing.remainingSize = totalSize;
                  existing.entrySize = totalSize;
                } else {
                  state.earlyExitTracker.set(tokenId, {
                    entryPrice: trade.price,
                    entrySize: tradeSize,
                    remainingSize: tradeSize,
                    firstSellDone: false,
                    marketSlug: trade.marketSlug || 'unknown',
                    entryTime: Date.now(),
                  });
                }
                log('EXIT', `Tracker'a eklendi: ${trade.marketSlug} @ $${trade.price} (${tradeSize} hisse)`);
              }
            } else {
              const errMsg = result.errorMsg || 'Bilinmeyen hata';
              log('ERROR', `Order failed: ${errMsg}`);
              sendTelegram(`❌ <b>İŞLEM BAŞARISIZ</b>\n\nMarket: ${trade.marketSlug}\nHata: ${errMsg}`);
            }
          } catch (err) {
            log('ERROR', `Trade execution error: ${(err as Error).message}`);
            sendTelegram(`❌ <b>İŞLEM HATASI</b>\n\n${(err as Error).message}`);
          } finally {
            pendingTrade = false;
          }
        }
      });
  }
  isSmartMoneyInitialized = true;
  isSmartMoneyInitializing = false;
}


// ============================================================================
// EARLY EXIT MONITOR - Kopyalanan pozisyonlarda kademeli cikis
// ============================================================================

async function setupEarlyExitMonitor(sdk: PolymarketSDK) {
  if (!CONFIG.earlyExit.enabled) return;

  log('EXIT', `Erken cikis monitoru baslatildi (kontrol: ${CONFIG.earlyExit.checkIntervalMs / 1000}s)`);
  log('EXIT', `Kurallar: +%${CONFIG.earlyExit.profitTarget1 * 100} -> %${CONFIG.earlyExit.sellAtTarget1 * 100} sat | +%${CONFIG.earlyExit.profitTarget2 * 100} -> kalanini sat`);

  const checkEarlyExits = async () => {
    if (!CONFIG.earlyExit.enabled) return;

    // Tracker'da olmayan hava durumu pozisyonlarini otomatik ekle
    for (const pos of state.positions) {
      const tokenId = pos.asset;
      if (!tokenId || state.earlyExitTracker.has(tokenId)) continue;

      const slug = (pos.slug || pos.title || pos.marketSlug || '').toLowerCase();
      const isWeather = slug.includes('temperature') || slug.includes('weather') ||
        slug.includes('highest') || slug.includes('lowest') || slug.includes('celsius') ||
        slug.includes('fahrenhe');
      if (!isWeather) continue;

      const entryPrice = Number(pos.avgPrice) || 0;
      const size = Number(pos.size) || 0;
      if (entryPrice <= 0 || size <= 0) continue;

      state.earlyExitTracker.set(tokenId, {
        entryPrice,
        entrySize: size,
        remainingSize: size,
        firstSellDone: false,
        marketSlug: slug,
        entryTime: Date.now(),
      });
      log('EXIT', `Mevcut pozisyon tracker'a eklendi: ${slug} @ $${entryPrice.toFixed(3)} (${size} hisse)`);
    }

    for (const [tokenId, tracker] of Array.from(state.earlyExitTracker.entries())) {
      try {
        // Mevcut fiyati bul (state.positions zaten zenginlestirilmis)
        const position = state.positions.find((p: any) => p.asset === tokenId);
        if (!position) {
          // Pozisyon artik yok (satis yapildi veya resolve oldu) -> tracker'dan sil
          state.earlyExitTracker.delete(tokenId);
          continue;
        }

        const currentPrice = Number((position as any).curPrice) || Number(position.msg_price) || 0;
        if (currentPrice <= 0) continue;

        const entryPrice = tracker.entryPrice;
        const pnlPct = (currentPrice - entryPrice) / entryPrice;
        const holdMinutes = (Date.now() - tracker.entryTime) / 60000;

        // STOP-LOSS: -%30 zararda hepsini sat (sermaye koruma)
        if (pnlPct <= -CONFIG.earlyExit.stopLossPct && tracker.remainingSize > 0) {
          log('EXIT', `🛑 STOP-LOSS (${(CONFIG.earlyExit.stopLossPct * 100)}%): ${tracker.marketSlug} | Giris: $${entryPrice.toFixed(3)} -> Simdi: $${currentPrice.toFixed(3)} (${(pnlPct * 100).toFixed(1)}%)`);
          await executeEarlyExit(tokenId, tracker.remainingSize, currentPrice, tracker);
          continue; // Bu pozisyonda devam etme
        }

        // ZAMAN LIMITI: Maksimum bekleme suresi dolduysa cik
        if (holdMinutes >= CONFIG.earlyExit.maxHoldMinutes && tracker.remainingSize > 0) {
          log('EXIT', `⏰ ZAMAN LIMIDI (${CONFIG.earlyExit.maxHoldMinutes}dk): ${tracker.marketSlug} | Giris: $${entryPrice.toFixed(3)} -> Simdi: $${currentPrice.toFixed(3)} (${(pnlPct * 100).toFixed(1)}%)`);
          await executeEarlyExit(tokenId, tracker.remainingSize, currentPrice, tracker);
          continue;
        }

        // HEDEF 1: +%20 karda yarisini sat (ilk satilmadiysa)
        if (!tracker.firstSellDone && pnlPct >= CONFIG.earlyExit.profitTarget1 && tracker.remainingSize > 0) {
          const sellAmount = Math.floor(tracker.remainingSize * CONFIG.earlyExit.sellAtTarget1);
          if (sellAmount >= 5) { // Polymarket minimum 5 hisse
            log('EXIT', `🎯 HEDEF 1 (+${(CONFIG.earlyExit.profitTarget1 * 100)}%): ${tracker.marketSlug} | Giris: $${entryPrice.toFixed(3)} -> Simdi: $${currentPrice.toFixed(3)} (+${(pnlPct * 100).toFixed(1)}%)`);
            await executeEarlyExit(tokenId, sellAmount, currentPrice, tracker);
            tracker.firstSellDone = true;
          }
        }

        // HEDEF 2: +%50 karda kalanini sat (Hedef 1'den sonra)
        if (tracker.firstSellDone && pnlPct >= CONFIG.earlyExit.profitTarget2 && tracker.remainingSize > 0) {
          log('EXIT', `🎯 HEDEF 2 (+${(CONFIG.earlyExit.profitTarget2 * 100)}%): ${tracker.marketSlug} | Giris: $${entryPrice.toFixed(3)} -> Simdi: $${currentPrice.toFixed(3)} (+${(pnlPct * 100).toFixed(1)}%)`);
          await executeEarlyExit(tokenId, tracker.remainingSize, currentPrice, tracker);
        }

      } catch (err) {
        log('EXIT', `Monitor hatasi (${tracker.marketSlug}): ${(err as Error).message}`);
      }
    }
  };

  // Periyodik kontrol
  setInterval(checkEarlyExits, CONFIG.earlyExit.checkIntervalMs);
  // İlk kontrol 20sn sonra (pozisyonlar sync edilsin)
  setTimeout(checkEarlyExits, 20000);
}

async function executeEarlyExit(
  tokenId: string,
  sellSize: number,
  currentPrice: number,
  tracker: { entryPrice: number; entrySize: number; remainingSize: number; firstSellDone: boolean; marketSlug: string; entryTime: number }
) {
  try {
    if (CONFIG.dryRun) {
      log('EXIT', `[DRY RUN] Satilacak: ${sellSize} hisse @ $${currentPrice.toFixed(3)} (${tracker.marketSlug})`);
      tracker.remainingSize -= sellSize;
      if (tracker.remainingSize <= 0) {
        state.earlyExitTracker.delete(tokenId);
      }
      return;
    }

    const sdk = sdkInstance;
    if (!sdk?.tradingService) {
      log('EXIT', `TradingService hazir degil, satilamadi: ${tracker.marketSlug}`);
      return;
    }

    // Throttle kontrol
    if (pendingTrade) {
      log('EXIT', `Pending trade var, beklenecek: ${tracker.marketSlug}`);
      return;
    }
    pendingTrade = true;

    try {
      const result = await sdk.tradingService.createMarketOrder({
        tokenId,
        side: 'SELL',
        amount: sellSize,
      });

      if (result.success) {
        const pnl = (currentPrice - tracker.entryPrice) * sellSize;
        const pnlEmoji = pnl >= 0 ? '✅' : '❌';
        log('EXIT', `${pnlEmoji} ERKEN CIKIS: ${sellSize} hisse @ $${currentPrice.toFixed(3)} | K/Z: $${pnl.toFixed(2)} | ${tracker.marketSlug}`);
        sendTelegram(`${pnlEmoji} <b>ERKEN ÇIKIŞ</b>\n\n📊 Market: ${tracker.marketSlug}\n💰 Hisse: ${sellSize}\n💲 Fiyat: $${currentPrice.toFixed(3)}\n📈 Giriş: $${tracker.entryPrice.toFixed(3)}\n💵 K/Z: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);

        tracker.remainingSize -= sellSize;
        if (tracker.remainingSize <= 0) {
          state.earlyExitTracker.delete(tokenId);
          log('EXIT', `Pozisyon tamamen kapatildi: ${tracker.marketSlug}`);
        } else {
          log('EXIT', `Kalan pozisyon: ${tracker.remainingSize} hisse (${tracker.marketSlug})`);
        }

        recordTrade(pnl, 'smartMoney');
      } else {
        log('EXIT', `Satis basarisiz: ${result.errorMsg} (${tracker.marketSlug})`);
      }
    } finally {
      pendingTrade = false;
    }
  } catch (err) {
    log('EXIT', `Cikis hatasi (${tracker.marketSlug}): ${(err as Error).message}`);
  }
}


async function setupArbitrage(_sdk: PolymarketSDK) {
  // Always setup service and listeners
  log('ARB', 'Setting up Arbitrage Service...');

  state.arbitrage.status = 'idle';
  updateDashboard();

  // Create standalone ArbitrageService (not using SDK wrapper)
  arbService = new ArbitrageService({
    privateKey: CONFIG.dryRun ? undefined : process.env.POLYMARKET_PRIVATE_KEY,
    profitThreshold: CONFIG.arbitrage.profitThreshold,
    minTradeSize: CONFIG.arbitrage.minTradeSize,
    maxTradeSize: CONFIG.arbitrage.maxTradeSize,
    autoExecute: !CONFIG.dryRun && CONFIG.arbitrage.autoExecute,
    enableRebalancer: !CONFIG.dryRun && CONFIG.arbitrage.enableRebalancer,
    enableLogging: true,
  });

  arbService.on('opportunity', (opp) => {
    state.activeArbMarket = opp.market?.name || 'scanning';
    state.arbitrage.opportunitiesFound++;
    state.arbitrage.lastOpportunity = {
      timestamp: new Date().toISOString(),
      type: opp.type as 'long' | 'short',
      profitPct: opp.profitPercent / 100,
      market: opp.market?.name || 'Unknown',
    };
    log('ARB', `Opportunity: ${opp.type.toUpperCase()} +${opp.profitPercent.toFixed(2)}%`);

    // SIMULATION HOOK
    if (CONFIG.dryRun && opp.profitPercent > 0) {
      // Conservative estimate: 10% of max size or min size
      const size = Math.max(CONFIG.arbitrage.minTradeSize, 10);
      const estimatedProfit = size * (opp.profitPercent / 100);
      simulateTrade(estimatedProfit, 'arbitrage', `Arb ${opp.market}`);
    }

    updateDashboard();
  });

  arbService.on('execution', (result) => {
    if (result.success) {
      state.arbProfit += result.profit || 0;
      recordTrade(result.profit || 0, 'arbitrage');
      log('TRADE', `Arb trade executed: +$${(result.profit || 0).toFixed(2)} profit`);
    }
  });

  // Scan for arbitrage opportunities ONLY if enabled
  if (CONFIG.arbitrage.enabled) {
    state.arbitrage.status = 'scanning';
    try {
      const results = await arbService.scanMarkets(
        { minVolume24h: CONFIG.arbitrage.minVolume24h },
        CONFIG.arbitrage.profitThreshold
      );
      state.arbitrage.marketsScanned = results.length;
      const opps = results.filter(r => r.arbType !== 'none');

      if (opps.length > 0) {
        state.activeArbMarket = opps[0].market.name;
        state.arbitrage.currentMarket = opps[0].market.name;
        state.arbitrage.status = 'monitoring';
        await arbService.start(opps[0].market);
        log('ARB', `Started monitoring: ${opps[0].market.name}`);
      } else {
        state.arbitrage.status = 'idle';
        log('ARB', 'No arbitrage opportunities found, will keep scanning...');
      }
      updateDashboard();
    } catch (err) {
      state.arbitrage.status = 'idle';
      log('WARN', `Arbitrage scan error: ${(err as Error).message}`);
      updateDashboard();
    }
  }
}

async function setupDipArb(sdk: PolymarketSDK) {
  // Always setup listeners provided by this function
  log('ARB', 'Setting up DipArb Service...');

  // Configure the DipArb service
  sdk.dipArb.updateConfig({
    shares: CONFIG.dipArb.shares,
    sumTarget: CONFIG.dipArb.sumTarget,
    autoExecute: !CONFIG.dryRun,
    debug: true,
  });

  // Event handlers - listen to orderbookUpdate for live orderbook data
  sdk.dipArb.on('orderbookUpdate', (update: {
    upPrice: number;
    downPrice: number;
    sum: number;
  }) => {
    state.dipArb.upPrice = update.upPrice;
    state.dipArb.downPrice = update.downPrice;
    state.dipArb.sum = update.sum;
    updateDashboard();
  });

  // Listen to 'started' event to sync market details immediately
  sdk.dipArb.on('started', (market: any) => {
    log('ARB', `DipArb Service Started Monitoring: ${market.name}`);
    state.activeDipArbMarket = market.name;
    state.dipArb.marketName = market.name;
    state.dipArb.underlying = market.underlying || 'ETH';
    state.dipArb.duration = `${market.durationMinutes}m`;
    state.dipArb.endTime = market.endTime ? new Date(market.endTime).getTime() : null;
    state.dipArb.status = 'active'; // Force status update
    updateDashboard();

    // Also notify dashboard specifically about status change
    dashboardEmitter.updateStrategyStatus('dipArb', 'active', market.name);
  });

  // Listen to newRound for round changes
  sdk.dipArb.on('newRound', (round: { roundId: string; priceToBeat: number }) => {
    log('ARB', `New round: ${round.roundId}, Price to Beat: ${round.priceToBeat}`);
    updateDashboard();
  });

  // Signal handler - extract data from DipArbLeg1Signal or DipArbLeg2Signal
  sdk.dipArb.on('signal', (s: {
    type: 'leg1' | 'leg2';
    dipSide?: string;
    hedgeSide?: string;
    currentPrice: number;
    source?: string;
    dropPercent?: number;
  }) => {
    const side = s.dipSide || s.hedgeSide || 'UP';
    const signal: DipArbSignal = {
      id: `da-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: s.type as DipArbSignal['type'],
      side: side as 'UP' | 'DOWN',
      price: s.currentPrice || 0,
      change: s.dropPercent ? -s.dropPercent * 100 : 0,
    };
    state.dipArb.lastSignal = signal;
    state.dipArb.signals.unshift(signal);
    if (state.dipArb.signals.length > 20) {
      state.dipArb.signals = state.dipArb.signals.slice(0, 20);
    }
    log('SIGNAL', `DipArb: ${s.type} ${side} @ ${s.currentPrice?.toFixed(3)}`);

    // NO SIMULATION on signal anymore - signals are not trades!
    // We only want to track actual executions (which will fire the 'execution' event)

    updateDashboard();
  });

  sdk.dipArb.on('execution', (r: any) => {
    if (r.success) {
      const price = r.price ? r.price.toFixed(3) : '??';
      const shares = r.shares ? r.shares.toFixed(1) : '??';
      const market = state.activeDipArbMarket || 'unknown-market';

      switch (r.leg) {
        case 'leg1':
          log('TRADE', `OPEN ${r.side} | ${shares} shares @ $${price} | ${market}`);
          break;
        case 'leg2':
          log('TRADE', `HEDGE ${r.side} | ${shares} shares @ $${price} | Locked Profit`);
          break;
        case 'exit':
          log('TRADE', `CLOSE ${r.side} (Timeout Exit) | ${shares} shares @ $${price}`);
          break;
        case 'merge':
          log('TRADE', `REDEEM | Merged positions for $1.00 payout | ${market}`);
          break;
        default:
          log('TRADE', `DipArb ${r.leg}: ${r.side} @ ${price}`);
      }
      recordTrade(0, 'dipArb');
    } else {
      log('WARN', `DipArb Execution Failed (${r.leg}): ${r.error || 'Unknown error'}`);
    }
  });

  sdk.dipArb.on('rotate', (e: { newMarket: string }) => {
    state.activeDipArbMarket = e.newMarket;
    state.dipArb.marketName = e.newMarket;
    log('ARB', `DipArb rotated to ${e.newMarket}`);
    updateDashboard();
  });

  // Enable auto-rotate if configured
  if (CONFIG.dipArb.autoRotate) {
    sdk.dipArb.enableAutoRotate({
      enabled: true,
      underlyings: ['ETH', 'BTC', 'SOL'],
      duration: '15m',
      settleStrategy: 'redeem',
      redeemWaitMinutes: 5,
    });
  }

  // Find and start monitoring a market
  if (CONFIG.dipArb.enabled) {
    try {
      const market = await sdk.dipArb.findAndStart({ coin: 'ETH', preferDuration: '15m' });
      if (market) {
        state.activeDipArbMarket = market.name;
        state.dipArb.marketName = market.name;
        state.dipArb.underlying = market.underlying || 'ETH';
        state.dipArb.duration = `${market.durationMinutes}m`;
        // endTime is a Date object, convert to timestamp
        state.dipArb.endTime = market.endTime ? new Date(market.endTime).getTime() : null;
        state.dipArb.status = 'active'; // Force status update
        log('ARB', `DipArb started: ${market.name}`);
      } else {
        log('WARN', 'No DipArb markets found');
      }
      updateDashboard();
    } catch (err) {
      log('WARN', `DipArb setup error: ${(err as Error).message}`);
    }
  }
}

let swapService: SwapService | null = null;

async function updateBalances() {
  if (sdkInstance) {
    try {
      const result = await sdkInstance.tradingService.getBalanceAllowance('COLLATERAL');
      const val = parseFloat(result.balance) / 1e6;
      state.usdcBalance = val;
      updateDashboard();
    } catch (err) {
      log('WARN', `CLOB balance: ${(err as Error).message}`);
    }
  }

  if (CONFIG.dryRun) {
    state.usdcEBalance = 10000 + state.totalPnL;
    state.maticBalance = 100;
    updateDashboard();
    return;
  }

  if (!swapService) return;
  try {
    const balances = await swapService.getBalances();
    let changed = false;

    for (const b of balances) {
      if (b.symbol === 'MATIC') {
        const val = parseFloat(b.balance);
        if (state.maticBalance !== val) { state.maticBalance = val; changed = true; }
      }
      if (b.symbol === 'USDC') {
        const val = parseFloat(b.balance);
        if (state.usdcBalance !== val) { state.usdcBalance = val; changed = true; }
      }
      if (b.symbol === 'USDC_E') {
        const val = parseFloat(b.balance);
        if (state.usdcEBalance !== val) { state.usdcEBalance = val; changed = true; }
      }
    }

    if (changed) updateDashboard();
  } catch { /* silent */ }
}

async function setupSwap() {
  log('SWAP', 'Setting up Wallet & Balance Monitor...');

  try {
    if (!process.env.POLYMARKET_PRIVATE_KEY) return;

    // Create SwapService with signer
    const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
    const signer = new ethers.Wallet(process.env.POLYMARKET_PRIVATE_KEY, provider);
    swapService = new SwapService(signer);

    // Initial fetch
    await updateBalances();

    log('SWAP', 'Balances:', {
      matic: state.maticBalance.toFixed(4),
      usdce: `$${state.usdcEBalance.toFixed(2)}`,
    });

    // Check for low USDC.e (Bridged) balance
    if (!CONFIG.dryRun && state.usdcEBalance < 5) {
      log('WARN', `⚠️ Low USDC.e balance ($${state.usdcEBalance.toFixed(2)}). Bot requires USDC.e (Bridged USDC) on Polygon.`);
      log('WARN', `ℹ️ Please deposit USDC.e or swap your Native USDC to USDC.e manually.`);
    }

    // Poll balances every 30 seconds
    setInterval(updateBalances, 30000);

    updateDashboard();
  } catch (err) {
    log('WARN', `Balance setup error: ${(err as Error).message}`);
  }
}

async function setupOnchain() {
  if (!CONFIG.onchain.enabled || CONFIG.dryRun) return;
  log('CHAIN', 'Checking on-chain approvals...');

  try {
    if (!process.env.POLYMARKET_PRIVATE_KEY) return;

    const onchain = new OnchainService({
      privateKey: process.env.POLYMARKET_PRIVATE_KEY,
      rpcUrl: 'https://polygon-rpc.com',
    });

    if (CONFIG.onchain.autoApprove) {
      log('CHAIN', 'Auto-approving Proxy and Exchange...');
      const result = await onchain.approveAll();

      if (result.allApproved) {
        log('CHAIN', '✅ All approvals ready');
      } else {
        log('WARN', `Approval status: ${result.summary}`);
        // Log individual failures
        result.erc20Approvals.forEach(r => {
          if (!r.success) log('WARN', `❌ ERC20 Approval failed: ${r.contract} - ${r.error}`);
        });
        result.erc1155Approvals.forEach(r => {
          if (!r.success) log('WARN', `❌ ERC1155 Approval failed: ${r.contract} - ${r.error}`);
        });
      }
    } else {
      const status = await onchain.checkAllowances();
      if (!status.tradingReady) {
        log('WARN', 'Missing approvals:', status.issues);
        log('WARN', 'Enable onchain.autoApprove=true to fix automatically');
      } else {
        log('CHAIN', '✅ Approvals verified');
      }
    }
  } catch (err) {
    log('WARN', `Onchain setup error: ${(err as Error).message}`);
  }
}

async function setupBinanceAnalysis(sdk: PolymarketSDK) {
  if (!CONFIG.binance.enabled) return;
  log('KLINE', 'Setting up Binance K-line analysis...');

  async function analyzeTrend(symbol: 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'): Promise<'up' | 'down' | 'neutral'> {
    try {
      const klines = await sdk.binance.getKLines(symbol, CONFIG.binance.interval, { limit: 20 });
      if (klines.length < 10) return 'neutral';

      const recent = klines.slice(-5);
      const older = klines.slice(-10, -5);

      const recentAvg = recent.reduce((s, k) => s + k.close, 0) / recent.length;
      const olderAvg = older.reduce((s, k) => s + k.close, 0) / older.length;

      const change = (recentAvg - olderAvg) / olderAvg;

      if (change > CONFIG.binance.trendThreshold / 100) return 'up';
      if (change < -CONFIG.binance.trendThreshold / 100) return 'down';
      return 'neutral';
    } catch {
      return 'neutral';
    }
  }

  async function updateTrends() {
    state.btcTrend = await analyzeTrend('BTCUSDT');
    state.ethTrend = await analyzeTrend('ETHUSDT');
    state.solTrend = await analyzeTrend('SOLUSDT');
    log('TREND', `BTC:${state.btcTrend} ETH:${state.ethTrend} SOL:${state.solTrend}`);
    updateDashboard();
  }

  await updateTrends();
  setInterval(updateTrends, 5 * 60 * 1000);
  await updateTrends();
  setInterval(updateTrends, 5 * 60 * 1000);
}

async function setupDirectTrading(sdk: PolymarketSDK) {
  log('INFO', 'Direct trading setup complete - waiting for toggle');

  if (CONFIG.directTrading.enabled) {
    if (CONFIG.dryRun) {
      log('INFO', 'Direct trading enabled (simulation mode)');
    } else {
      log('INFO', 'Direct trading enabled - will place orders based on trend analysis');
    }
  }

  async function checkTrendTrades() {
    if (!CONFIG.directTrading.enabled) return;
    if (!canTrade()) return;

    try {
      const trendingMarkets = await sdk.gammaApi.getTrendingMarkets(5);

      for (const market of trendingMarkets) {
        if (!market.conditionId) continue;

        try {
          const fullMarket = await sdk.getMarket(market.conditionId);
          const yesToken = fullMarket.tokens.find(t => t.outcome === 'Yes');
          const noToken = fullMarket.tokens.find(t => t.outcome === 'No');

          if (!yesToken || !noToken) continue;

          const isCryptoMarket = /btc|bitcoin|eth|ethereum|sol|solana/i.test(market.question || '');

          if (isCryptoMarket && CONFIG.directTrading.trendFollowing) {
            let trend: 'up' | 'down' | 'neutral' = 'neutral';
            if (/btc|bitcoin/i.test(market.question || '')) trend = state.btcTrend;
            else if (/eth|ethereum/i.test(market.question || '')) trend = state.ethTrend;
            else if (/sol|solana/i.test(market.question || '')) trend = state.solTrend;

            if (trend !== 'neutral') {
              // Strategy: 
              // UP -> Expect YES to win -> Buy YES
              // DOWN -> Expect YES to lose -> Buy NO
              const targetToken = trend === 'up' ? yesToken : noToken;
              const side = 'BUY'; // We always BUY the outcome we believe in
              const price = targetToken.price;

              if (CONFIG.dryRun) {
                // Simulate the trade in DRY RUN mode
                simulateTrade(0, 'direct', `Trend signal: ${market.question?.slice(0, 40)}... → ${trend.toUpperCase()} (Buy ${targetToken.outcome}) @ ${price.toFixed(2)}`);
                state.directTrades = (state.directTrades ?? 0) + 1;
                updateDashboard();
              } else {
                // Live Mode Execution
                const amountUsdc = 5; // Fixed small size for testing ($5)

                log('SIGNAL', `Executing Trend Trade: ${trend.toUpperCase()} on ${market.question?.slice(0, 30)}...`);

                sdk.tradingService.createMarketOrder({
                  tokenId: targetToken.tokenId,
                  side: 'BUY',
                  amount: amountUsdc
                }).then(res => {
                  if (res.success) {
                    log('TRADE', `✅ Direct Trade: Bought $${amountUsdc} of ${targetToken.outcome} @ ~${price.toFixed(2)}`);
                    recordTrade(0, 'direct');
                  } else {
                    log('WARN', `❌ Direct Trade failed: ${res.errorMsg}`);
                  }
                });
              }
            }
          }
        } catch { /* skip */ }
      }
    } catch (err) {
      log('WARN', `Direct trading error: ${(err as Error).message}`);
    }
  }

  // Check every 5 minutes
  setInterval(checkTrendTrades, 5 * 60 * 1000);
  // Initial check after 10 seconds (let trends stabilize)
  setTimeout(checkTrendTrades, 10000);
}

// ponytail: Polymarket positions live on the proxy wallet (FUNDER_ADDRESS),
// not the raw private key address. Use FUNDER_ADDRESS for position fetches.
const PROXY_WALLET = (process.env.FUNDER_ADDRESS || '').toLowerCase();

async function setupPortfolioManager(sdk: PolymarketSDK) {
  const walletAddr = PROXY_WALLET || sdk.tradingService.getAddress();
  log('INFO', 'Starting Portfolio Manager...');
  log('WALLET', `Fetching positions for: ${walletAddr}`);

  // Initial Sync
  try {
    const positions = await sdk.wallets.getWalletPositions(walletAddr);
    state.positions = positions;
    log('WALLET', `Synced ${positions.length} existing positions.`);
    updateDashboard();
  } catch (err: any) {
    log('WARN', `Portfolio Sync failed: ${err.message}`);
  }

  // Periodic Position Sync (Every 30s)
  setInterval(async () => {
    try {
      const positions = await sdk.wallets.getWalletPositions(walletAddr);

      // Enrich positions with market data (to check if won or lost)
      const enrichedPositions = await Promise.all(positions.map(async (pos: any) => {
        try {
          // Use cached market data if available
          const market = await sdk.markets.getMarket(pos.conditionId);
          if (market) {
            pos.marketClosed = market.closed;

            // Enrich with current price for PnL
            // Try to find the token in the market outcomes
            const token = market.tokens.find((t: any) => t.tokenId === pos.asset);

            if (token) {
              pos.isWinner = token.winner || false;
              // Store current price for frontend
              pos.curPrice = token.price || 0;
            }

            // If market is closed but winner info is missing/false, assume lost unless proven otherwise
            if (market.closed && !pos.isWinner) {
              // Double check if ANY token won (if market resolved)
            }
          }
        } catch (e) {
          // Ignore market fetch errors, keep basic pos data
        }
        return pos;
      }));

      // Calculate Unrealized PnL
      let unrealized = 0;
      for (const p of enrichedPositions) {
        const entry = Number(p.avgPrice) || 0;
        const current = Number(p.curPrice) || Number(p.msg_price) || 0;
        const size = Number(p.size) || 0;

        if (current > 0 && size > 0) {
          unrealized += (current - entry) * size;
        }
      }
      state.unrealizedPnL = unrealized;

      // Update Total PnL display to include Unrealized? 
      // User requested "P&L total is still not updating".
      // Usually Total = Realized + Unrealized.
      // But we keep them separate in state, let frontend decide how to show.

      state.positions = enrichedPositions;
      updateDashboard();
    } catch (err: any) {
      log('WARN', `Portfolio sync error: ${err.message}`);
    }
  }, 30 * 1000);
}

async function main() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          POLYMARKET BOT v3.0 + DASHBOARD                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Start Dashboard Server
  startDashboard(3001);
  console.log('\n🌐 Dashboard: http://localhost:3001\n');

  if (!process.env.POLYMARKET_PRIVATE_KEY) {
    log('ERROR', 'POLYMARKET_PRIVATE_KEY not found');
    process.exit(1);
  }

  // Send config to dashboard
  const dashboardConfig: BotConfig = {
    capital: CONFIG.capital,
    risk: CONFIG.risk,
    smartMoney: {
      enabled: CONFIG.smartMoney.enabled,
      topN: CONFIG.smartMoney.topN,
      minWinRate: CONFIG.smartMoney.minWinRate,
      minPnl: CONFIG.smartMoney.minPnl,
      minTrades: CONFIG.smartMoney.minTrades,
      customWallets: CONFIG.smartMoney.customWallets,
    },
    arbitrage: {
      enabled: CONFIG.arbitrage.enabled,
      profitThreshold: CONFIG.arbitrage.profitThreshold,
      autoExecute: CONFIG.arbitrage.autoExecute,
    },
    dipArb: {
      enabled: CONFIG.dipArb.enabled,
      coins: CONFIG.dipArb.coins,
    },
    directTrading: {
      enabled: CONFIG.directTrading.enabled,
    },
    binance: {
      enabled: CONFIG.binance.enabled,
    },
    earlyExit: CONFIG.earlyExit,
    dryRun: CONFIG.dryRun,
  };
  dashboardEmitter.updateConfig(dashboardConfig);
  dashboardEmitter.updateState(state);

  log('INFO', 'Configuration', {
    binance: CONFIG.binance.enabled,
  });

  // Handle Dashboard Commands
  dashboardEmitter.on('command', async (cmd: { command: string; payload: any }) => {
    if (cmd.command === 'toggleDryRun') {
      const enable = cmd.payload.enabled;
      if (CONFIG.dryRun === !enable) {
        log('INFO', `Switching to ${!enable ? 'LIVE' : 'DRY RUN'} mode... (Requested by user)`);

        // Update Config
        CONFIG.dryRun = !enable; // payload.enabled is "isLive?" or "isDryRun?" - let's assume payload.enabled is the NEW STATE for dryRun? 
        // Wait, usually toggles send the new desired state. 
        // Using "enabled" as "isDryRun enabled"
        CONFIG.dryRun = !!enable;

        // Update State paper wallet
        if (CONFIG.dryRun && !state.paper) {
          state.paper = {
            balance: CONFIG.capital.totalUsd,
            initialBalance: CONFIG.capital.totalUsd,
            pnl: 0,
            trades: 0,
            totalVolume: 0,
          };
        }

        // Re-configure Services

        // 1. Arbitrage Service (Needs restart to update signer/sim mode)
        if (arbService) {
          // Update internal flags if possible without full restart? 
          // ArbitrageService takes readonly config in constructor. Better to re-create.
          await arbService.stop();
          // Re-run setup
          await setupArbitrage(sdk);
        }

        // 2. DipArb (Update config)
        sdk.dipArb.updateConfig({
          autoExecute: !CONFIG.dryRun, // Live = autoExecute true (if config enabled)
        });

        // Emit new config to dashboard
        const newDashboardConfig: BotConfig = {
          capital: CONFIG.capital,
          risk: CONFIG.risk,
          smartMoney: { ...CONFIG.smartMoney },
          arbitrage: { ...CONFIG.arbitrage },
          dipArb: { ...CONFIG.dipArb },
          directTrading: { ...CONFIG.directTrading },
          binance: { ...CONFIG.binance },
          earlyExit: CONFIG.earlyExit,
          dryRun: CONFIG.dryRun,
        };
        dashboardEmitter.updateConfig(newDashboardConfig);

        log('WARN', `⚠️ BOT MODE CHANGED TO: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
      }
    }
  });

  // Initialize Paper Wallet if Dry Run
  if (CONFIG.dryRun) {
    state.paper = {
      balance: CONFIG.capital.totalUsd,
      initialBalance: CONFIG.capital.totalUsd,
      pnl: 0,
      trades: 0,
      totalVolume: 0,
    };
    log('INFO', '📝 Paper Trading Activated: Simulating trades with $250 initial capital');
    updateDashboard();
  }

  const sdk = await PolymarketSDK.create({
    privateKey: process.env.POLYMARKET_PRIVATE_KEY,
    funderAddress: process.env.FUNDER_ADDRESS,
    signatureType: parseInt(process.env.SIGNATURE_TYPE || '3'),
  });

  log('INFO', `Wallet: ${sdk.tradingService.getAddress()}`);
  sdkInstance = sdk;

  // CLOB balance first (independent of RPC/swap setup)
  await updateBalances();

  // Setup all services
  await setupOnchain(); // MUST BE FIRST (Approvals)
  await setupSwap();
  await setupBinanceAnalysis(sdk);
  await setupSmartMoney(sdk);
  await setupEarlyExitMonitor(sdk);
  await setupArbitrage(sdk);
  await setupDipArb(sdk);

  // Periodic state update
  setInterval(() => {
    updateDashboard();
  }, 5000);

  // Periodic CLOB balance refresh (independent of setupSwap)
  setInterval(updateBalances, 30000);

  // Setup Direct Trading
  await setupDirectTrading(sdk);

  // Setup Portfolio Manager (Persistence)
  await setupPortfolioManager(sdk);

  // Listen for commands from dashboard
  dashboardEmitter.on('command', async ({ command, payload }: { command: string; payload: any }) => {
    if (command === 'closePosition') {
      const { tokenId, size } = payload;
      log('TRADE', `Closing position: ${tokenId} (${size} shares)`);

      if (CONFIG.dryRun) {
        log('TRADE', `[SIMULATION] Would sell ${size} shares of ${tokenId}`);
        return;
      }

      try {
        // Estimate PnL before closing (using cached data)
        const position = state.positions.find(p => p.asset === tokenId);
        let estimatedPnL = 0;
        if (position) {
          const entryPrice = Number(position.avgPrice) || 0;
          // Use current market price if available, otherwise assume break-even or roughly current avg
          // Ideally we'd have the live mid-price. 'curPrice' might be in position if enriched.
          const exitPrice = Number((position as any).curPrice) || Number(position.msg_price) || 0;

          if (exitPrice > 0) {
            estimatedPnL = (exitPrice - entryPrice) * size;
          }
        }

        const res = await sdk.tradingService.createMarketOrder({
          tokenId,
          side: 'SELL',
          amount: size,
        });

        if (res.success) {
          log('TRADE', `✅ Position closed: ${size} shares sold`);
          if (estimatedPnL !== 0) {
            recordTrade(estimatedPnL, 'manual');
            log('INFO', `Realized PnL (Est): $${estimatedPnL.toFixed(2)}`);
          }
        } else {
          log('WARN', `❌ Close failed: ${res.errorMsg}`);
        }
      } catch (err: any) {
        log('WARN', `❌ Close error: ${err.message}`);
      }
    }

    if (command === 'toggleStrategy') {
      const { strategy, enabled } = payload;
      const strategyName = strategy as keyof typeof CONFIG;

      if (CONFIG[strategyName] && typeof (CONFIG[strategyName] as any).enabled !== 'undefined') {
        (CONFIG[strategyName] as any).enabled = enabled;
        log('INFO', `⚙️ Strategy ${strategy} ${enabled ? 'ENABLED' : 'DISABLED'}`);

        // Actively Start/Stop Services based on toggle
        try {
          if (strategy === 'dipArb') {
            if (enabled) {
              if (sdk.dipArb.isActive()) {
                log('WARN', `DipArb is already running.`);
              } else {
                log('INFO', `Starting DipArb Service (Scanning for markets)...`);
                await sdk.dipArb.findAndStart();
              }
            } else {
              log('INFO', `Stopping DipArb Service...`);
              await sdk.dipArb.stop();
            }
          } else if (strategy === 'arbitrage') {
            if (enabled) {
              if (arbService) {
                // Update config
                arbService.updateConfig({
                  profitThreshold: CONFIG.arbitrage.profitThreshold,
                  autoExecute: CONFIG.arbitrage.autoExecute,
                });

                if (arbService.isActive()) {
                  log('WARN', `Arbitrage Service is already running.`);
                } else {
                  log('INFO', `Starting Arbitrage Service...`);

                  // Try to scan and start a market if possible
                  try {
                    const results = await arbService.scanMarkets({ minVolume24h: 1000 }, CONFIG.arbitrage.profitThreshold);
                    const best = results.find(r => r.arbType !== 'none') || results[0]; // Pick best or just first to monitor

                    if (best) {
                      await arbService.start(best.market);
                      state.activeArbMarket = best.market.name;
                      state.arbitrage.status = 'monitoring';
                      log('ARB', `Auto-started monitoring: ${best.market.name}`);
                      updateDashboard();
                    } else {
                      state.arbitrage.status = 'idle';
                      log('WARN', 'Arbitrage Service started but no markets found. Will keep scanning in background if configured.');
                      updateDashboard();
                    }
                  } catch (e) {
                    state.arbitrage.status = 'idle';
                    log('WARN', `Arbitrage auto-start failed: ${(e as Error).message}`);
                    updateDashboard();
                  }
                }
              } else {
                log('ERROR', 'Arbitrage Service not initialized. Restart bot.');
              }
            } else {
              log('INFO', `Stopping Arbitrage Service...`);
              if (arbService) {
                await arbService.stop();
                state.arbitrage.status = 'idle';
                updateDashboard();
              }
            }
          } else if (strategy === 'smartMoney') {
            if (enabled) {
              log('INFO', `Initializing Smart Money...`);
              // Call the lazy initializer we created
              initializeSmartMoney(sdk);
            } else {
              log('INFO', `Smart Money monitoring disabled.`);
            }
          } else if (strategy === 'directTrading') {
            if (enabled) {
              log('INFO', `Triggering Direct Trading analysis...`);
              // We can't easily reach the inner function checkTrendTrades from here because it's scoped inside setupDirectTrading.
              // However, checkTrendTrades runs on an interval and checks the config flag. 
              // By enabling the flag, the NEXT interval will pick it up.
              // To be immediate, we'd need to expose it, but simplified "Wait for next cycle" is acceptable or we can just log.
              log('INFO', `Direct Trading will run on next cycle (within 5 min).`);
            }
          }
        } catch (err: any) {
          log('WARN', `Failed to toggle service: ${err.message}`);
        }

        // Broadcast updated config to dashboard
        const dashboardConfig: BotConfig = {
          // ... (rest of config mapping)
          capital: CONFIG.capital,
          risk: CONFIG.risk,
          smartMoney: {
            enabled: CONFIG.smartMoney.enabled,
            topN: CONFIG.smartMoney.topN,
            minWinRate: CONFIG.smartMoney.minWinRate,
            minPnl: CONFIG.smartMoney.minPnl,
            minTrades: CONFIG.smartMoney.minTrades,
            customWallets: CONFIG.smartMoney.customWallets,
          },
          arbitrage: {
            enabled: CONFIG.arbitrage.enabled,
            profitThreshold: CONFIG.arbitrage.profitThreshold,
            autoExecute: CONFIG.arbitrage.autoExecute,
          },
          dipArb: {
            enabled: CONFIG.dipArb.enabled,
            coins: CONFIG.dipArb.coins,
          },
          directTrading: {
            enabled: CONFIG.directTrading.enabled,
          },
          binance: {
            enabled: CONFIG.binance.enabled,
          },
          earlyExit: CONFIG.earlyExit,
          dryRun: CONFIG.dryRun,
        };
        dashboardEmitter.updateConfig(dashboardConfig);
      } else {
        log('WARN', `Unknown strategy: ${strategy}`);
      }
    }

    if (command === 'redeemPosition') {
      const { conditionId } = payload;
      log('CHAIN', `Redeem requested for: ${conditionId}`);

      if (CONFIG.dryRun) {
        log('CHAIN', `[SIMULATION] Would redeem position ${conditionId}`);
        return;
      }

      try {
        // Create CTFClient instance for on-chain redemption
        const ctfClient = new CTFClient({
          privateKey: process.env.POLYMARKET_PRIVATE_KEY!,
        });

        // 1. Fetch market details to get Token IDs (required for Polymarket CLOB redemption)
        // We use the Gamma API (via sdk.markets or sdk.gammaApi)
        log('CHAIN', `Fetching market details for condition ${conditionId}...`);
        const market = await sdk.markets.getMarket(conditionId);

        if (!market || !market.tokens || market.tokens.length < 2) {
          log('WARN', `❌ Redeem failed: Valid market not found for condition ${conditionId}`);
          return;
        }

        const tokenIds = {
          yesTokenId: market.tokens[0].tokenId,
          noTokenId: market.tokens[1].tokenId,
        };

        log('CHAIN', `Found market: ${market.question} (Tokens: ${tokenIds.yesTokenId.slice(0, 10)}... / ${tokenIds.noTokenId.slice(0, 10)}...)`);

        // 2. Redeem using Polymarket Token IDs
        const result = await ctfClient.redeemByTokenIds(conditionId, tokenIds);

        if (result.success) {
          log('CHAIN', `✅ Redeemed! ${result.tokensRedeemed} tokens → ${result.usdcReceived} USDC`);
          log('CHAIN', `   Tx: ${result.txHash}`);
        } else {
          log('WARN', `❌ Redeem failed`);
        }
      } catch (err: any) {
        log('WARN', `❌ Redeem error: ${err.message}`);
      }
    }
  });

  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    if (arbService) await arbService.stop();
    await sdk.dipArb.stop();
    sdk.stop();
    process.exit(0);
  });

  log('INFO', '🚀 Bot + Dashboard running! Press Ctrl+C to stop.\n');

  // TELEGRAM: Bot başlangıç bildirimi
  sendTelegram(`🚀 <b>POLYMARKET BOT BAŞLADI</b>\n\n` +
    `📊 Mod: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 CANLI İŞLEM'}` +
    `\n👛 Takip: ${CONFIG.smartMoney.customWallets[0]?.slice(0, 10)}...` +
    `\n💰 Maks İşlem: $${CONFIG.smartMoney.maxSizePerTrade}`);

  // Status Display Loop
  function displayStatus() {
    const runtime = Math.round((Date.now() - state.startTime) / 1000 / 60);

    console.log('\n' + '═'.repeat(70));
    console.log('              POLYMARKET BOT v3.0 STATUS');
    console.log('═'.repeat(70));
    console.log(`  Runtime:        ${runtime} minutes`);
    console.log(`  Mode:           ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`  Status:         ${state.isPaused ? '⏸️ PAUSED' : '▶️ ACTIVE'}`);
    console.log('─'.repeat(70));
    console.log('  BALANCES:');
    console.log(`    MATIC:        ${state.maticBalance.toFixed(4)}`);
    console.log(`    USDC:         $${state.usdcBalance.toFixed(2)}`);
    console.log(`    USDC.e:       $${state.usdcEBalance.toFixed(2)}`);
    console.log('─'.repeat(70));
    console.log('  STRATEGIES:');
    console.log(`    Smart Money:  ${state.smartMoneyTrades} trades | ${state.followedWallets.length} wallets`);
    console.log(`    Arbitrage:    ${state.arbTrades} trades`);
    console.log(`    DipArb:       ${state.dipArbTrades} trades`);
    console.log('═'.repeat(70) + '\n');
  }

  setInterval(displayStatus, 60000);
  displayStatus(); // Initial call
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  console.error(err);
  process.exit(1);
});
