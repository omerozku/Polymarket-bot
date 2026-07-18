/**
 * Hava durumu marketlerinde aktif ve istikrarlı cüzdanları bul
 * 
 * Kriterler:
 * - Sıcaklık/hava durumu marketlerinde aktif
 * - Yüksek win rate (>60%)
 * - Tutarlı kâr (consistency score >0.7)
 * - Makul işlem hacmi
 * - Tek trade dominance yok (whale değil)
 */

import { PolymarketSDK } from '../src/index.js';

const WEATHER_PATTERN = /(temp|weather|hava|sicaklik|sogukluk|degree|celsius|fahrenhe|highest|lowest|temperature)/i;

interface WalletScore {
  address: string;
  rank: number;
  pnl: number;
  volume: number;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  consistencyScore: number;
  weatherTradeCount: number;
  totalPositions: number;
  avgPositionSize: number;
  smartScore: number;
}

async function main() {
  console.log('=== Hava Durumu Cüzdan Araştırması ===\n');

  const sdk = await PolymarketSDK.create();

  // 1. Leaderboard'dan top trader'ları al
  console.log('1. Leaderboard yükleniyor...');
  const leaderboard = await sdk.dataApi.fetchLeaderboard({ limit: 50 });
  console.log(`   ${leaderboard.entries.length} trader bulundu\n`);

  const walletScores: WalletScore[] = [];

  // 2. Her trader'ı analiz et
  for (let i = 0; i < leaderboard.entries.length; i++) {
    const entry = leaderboard.entries[i];
    const addr = entry.address;

    try {
      // Pozisyonları al
      const positions = await sdk.dataApi.getPositions(addr);
      if (positions.length < 5) continue; // Çok az pozisyon varsa atla

      // Hava durumu pozisyonlarını filtrele
      const weatherPositions = positions.filter(p => {
        const title = (p.title || '').toLowerCase();
        const slug = (p as any).slug || '';
        return WEATHER_PATTERN.test(title) || WEATHER_PATTERN.test(slug);
      });

      // En az 3 hava durumu pozisyonu olmalı
      if (weatherPositions.length < 3) continue;

      // Win rate hesapla
      const wins = weatherPositions.filter(p => (p.cashPnl ?? 0) > 0);
      const losses = weatherPositions.filter(p => (p.cashPnl ?? 0) < 0);
      const winRate = weatherPositions.length > 0 ? wins.length / weatherPositions.length : 0;

      // Profit factor hesapla
      const totalWins = wins.reduce((sum, p) => sum + Math.abs(p.cashPnl ?? 0), 0);
      const totalLosses = losses.reduce((sum, p) => sum + Math.abs(p.cashPnl ?? 0), 0);
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 10 : 0);

      // Consistency score - son 10 pozisyondaki performans
      const recentPositions = positions.slice(0, 10);
      const recentWins = recentPositions.filter(p => (p.cashPnl ?? 0) > 0).length;
      const consistencyScore = recentPositions.length > 0 ? recentWins / recentPositions.length : 0;

      // Whale check - tek pozisyonun toplamın >%40'ı olmamalı
      const sortedPnl = positions.map(p => Math.abs(p.cashPnl ?? 0)).sort((a, b) => b - a);
      const biggestTrade = sortedPnl[0] ?? 0;
      const totalAbsPnl = sortedPnl.reduce((s, v) => s + v, 0);
      const singleTradeExposure = totalAbsPnl > 0 ? biggestTrade / totalAbsPnl : 0;

      // Ortalama pozisyon büyüklüğü
      const avgPositionSize = weatherPositions.reduce((sum, p) => {
        const size = Number(p.size) || 0;
        const price = Number(p.avgPrice) || 0;
        return sum + (size * price);
      }, 0) / weatherPositions.length;

      // Smart score (basitleştirilmiş)
      const smartScore = Math.min(100, Math.round(
        (winRate * 30) +
        (Math.min(profitFactor, 5) / 5 * 25) +
        (consistencyScore * 25) +
        (Math.min(weatherTradeCount / 10, 1) * 20)
      ));

      walletScores.push({
        address: addr,
        rank: entry.rank,
        pnl: entry.pnl,
        volume: entry.volume,
        tradeCount: entry.tradeCount || 0,
        winRate,
        profitFactor,
        consistencyScore,
        weatherTradeCount: weatherPositions.length,
        totalPositions: positions.length,
        avgPositionSize,
        smartScore,
      });

      // İlerleme
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`   ${i + 1}/${leaderboard.entries.length} analiz edildi...\r`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      // Hata olursa atla
    }
  }

  console.log('\n\n3. Sonuçlar sıralanıyor...\n');

  // 4. Filtrele ve sırala
  const qualified = walletScores
    .filter(w =>
      w.winRate >= 0.55 &&           // %55+ win rate
      w.profitFactor >= 1.2 &&       // 1.2x+ profit factor
      w.consistencyScore >= 0.6 &&   // %60+ consistency
      w.weatherTradeCount >= 3 &&    // En az 3 hava trade'i
      w.singleTradeExposure <= 0.4 && // Whale değil
      w.avgPositionSize >= 1 &&      // Minimum pozisyon büyüklüğü
      w.avgPositionSize <= 20        // Çok büyük pozisyon yok
    )
    .sort((a, b) => b.smartScore - a.smartScore)
    .slice(0, 10);

  // 5. Sonuçları göster
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('       EN İYİ HAVA DURUMU CÜZDANLARI (Top 10)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < qualified.length; i++) {
    const w = qualified[i];
    console.log(`#${i + 1} ${w.address}`);
    console.log(`   Smart Score: ${w.smartScore}/100`);
    console.log(`   Win Rate: ${(w.winRate * 100).toFixed(1)}%`);
    console.log(`   Profit Factor: ${w.profitFactor.toFixed(2)}x`);
    console.log(`   Consistency: ${(w.consistencyScore * 100).toFixed(0)}%`);
    console.log(`   Hava Durumu İşlemleri: ${w.weatherTradeCount}/${w.totalPositions}`);
    console.log(`   Ort. Pozisyon: $${w.avgPositionSize.toFixed(2)}`);
    console.log(`   Toplam PnL: $${w.pnl.toLocaleString()}`);
    console.log(`   Hacim: $${w.volume.toLocaleString()}`);
    console.log(`   Leaderboard Rank: #${w.rank}`);
    console.log('');
  }

  // 6. En iyi 3 cüzdanı öner
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('       ÖNERİLER');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (qualified.length >= 3) {
    console.log('Bot config\'e eklenecek cüzdanlar:\n');
    console.log('customWallets: [');
    for (let i = 0; i < Math.min(3, qualified.length); i++) {
      const w = qualified[i];
      console.log(`  '${w.address}',  // #${i + 1} - WR:${(w.winRate * 100).toFixed(0)}% PF:${w.profitFactor.toFixed(1)}x`);
    }
    console.log(']');
  } else {
    console.log('Yeterli cüzdan bulunamadı. Filtreleri gevşetmeyi deneyin.');
  }

  console.log('\n=== Tamamlandı ===');
}

main().catch(console.error);
