/**
 * Hava durumu marketlerinde aktif cüzdanları bul (gevşek filtre)
 */

import { PolymarketSDK } from '../src/index.js';

const WEATHER_PATTERN = /(temp|weather|hava|sicaklik|sogukluk|degree|celsius|fahrenhe|highest|lowest|temperature)/i;

async function main() {
  console.log('=== Hava Durumu Cüzdan Araştırması v2 ===\n');

  const sdk = await PolymarketSDK.create();

  // 1. Leaderboard'dan top trader'ları al
  console.log('1. Leaderboard yükleniyor...');
  const leaderboard = await sdk.dataApi.fetchLeaderboard({ limit: 30 });
  console.log(`   ${leaderboard.entries.length} trader bulundu\n`);

  interface WalletInfo {
    address: string;
    rank: number;
    pnl: number;
    volume: number;
    tradeCount: number;
    winRate: number;
    profitFactor: number;
    weatherTradeCount: number;
    totalPositions: number;
    sampleWeatherMarkets: string[];
    avgSize: number;
  }

  const wallets: WalletInfo[] = [];

  // 2. Her trader'ı analiz et
  for (let i = 0; i < leaderboard.entries.length; i++) {
    const entry = leaderboard.entries[i];
    const addr = entry.address;

    try {
      // Pozisyonları al
      const positions = await sdk.dataApi.getPositions(addr);
      if (positions.length < 3) continue;

      // Hava durumu pozisyonlarını filtrele
      const weatherPositions = positions.filter(p => {
        const title = (p.title || '').toLowerCase();
        return WEATHER_PATTERN.test(title);
      });

      // En az 1 hava durumu pozisyonu olmalı (gevşek filtre)
      if (weatherPositions.length < 1) continue;

      // Win rate hesapla (tüm pozisyonlar)
      const allWins = positions.filter(p => (p.cashPnl ?? 0) > 0);
      const winRate = positions.length > 0 ? allWins.length / positions.length : 0;

      // Profit factor
      const totalWins = allWins.reduce((sum, p) => sum + Math.abs(p.cashPnl ?? 0), 0);
      const allLosses = positions.filter(p => (p.cashPnl ?? 0) < 0);
      const totalLosses = allLosses.reduce((sum, p) => sum + Math.abs(p.cashPnl ?? 0), 0);
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 5 : 0);

      // Ortalama pozisyon büyüklüğü
      const avgSize = positions.reduce((sum, p) => {
        const size = Number(p.size) || 0;
        const price = Number(p.avgPrice) || 0;
        return sum + (size * price);
      }, 0) / positions.length;

      // Örnek hava durumu marketleri
      const sampleMarkets = weatherPositions.slice(0, 3).map(p => (p.title || '').slice(0, 50));

      wallets.push({
        address: addr,
        rank: entry.rank,
        pnl: entry.pnl,
        volume: entry.volume,
        tradeCount: entry.tradeCount || 0,
        winRate,
        profitFactor,
        weatherTradeCount: weatherPositions.length,
        totalPositions: positions.length,
        sampleWeatherMarkets: sampleMarkets,
        avgSize,
      });

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`   ${i + 1}/${leaderboard.entries.length} analiz edildi...\r`);
      }

      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      // Hata olursa atla
    }
  }

  console.log('\n\n2. Sonuçlar:\n');

  // 3. Sırala ve göster
  const sorted = wallets
    .sort((a, b) => {
      // Hava durumu pozisyonu çok olanlar öne
      const scoreA = a.weatherTradeCount * 10 + a.winRate * 5 + a.profitFactor;
      const scoreB = b.weatherTradeCount * 10 + b.winRate * 5 + b.profitFactor;
      return scoreB - scoreA;
    })
    .slice(0, 15);

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('       HAVA DURUMU İŞLEM YAPAN CÜZDANLAR');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    console.log(`#${i + 1} ${w.address}`);
    console.log(`   Win Rate: ${(w.winRate * 100).toFixed(0)}% | PF: ${w.profitFactor.toFixed(1)}x | Hava İşlemleri: ${w.weatherTradeCount}/${w.totalPositions}`);
    console.log(`   PnL: $${w.pnl.toLocaleString()} | Hacim: $${w.volume.toLocaleString()}`);
    console.log(`   Ort. Pozisyon: $${w.avgSize.toFixed(2)} | Rank: #${w.rank}`);
    console.log(`   Örnek Marketler: ${w.sampleWeatherMarkets.join(' | ')}`);
    console.log('');
  }

  // 4. En iyi 3'ü öner
  const best3 = sorted.slice(0, 3);
  if (best3.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('       BOT İÇİN ÖNERİLEN CÜZDANLAR');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log('customWallets: [');
    for (const w of best3) {
      console.log(`  '${w.address}',  // #${w.rank} - WR:${(w.winRate * 100).toFixed(0)}% PF:${w.profitFactor.toFixed(1)}x Hava:${w.weatherTradeCount}`);
    }
    console.log(']');
  }

  console.log('\n=== Tamamlandı ===');
}

main().catch(console.error);
