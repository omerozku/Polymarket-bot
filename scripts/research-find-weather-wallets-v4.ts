/**
 * Hava durumu cüzdanlarını bul - basitleştirilmiş yaklaşım
 * Doğrudan bilinen hava durumu marketlerinden işlemler çek
 */

import { PolymarketSDK } from '../src/index.js';

async function main() {
  console.log('=== Hava Durumu Cüzdan Analizi v4 ===\n');

  const sdk = await PolymarketSDK.create();

  // Bilinen hava durumu market slug'ları (bugünkü loglardan)
  const weatherSlugs = [
    'highest-temperature-in-helsinki-on-july-18-2026',
    'highest-temperature-in-seoul-on-july-18-2026',
    'highest-temperature-in-wuhan-on-july-18-2026',
    'highest-temperature-in-amsterdam-on-july-18-2026',
    'highest-temperature-in-kuala-lumpur-on-july-18-2026',
    'highest-temperature-in-tel-aviv-on-july-20-2026',
    'highest-temperature-in-london-on-july-19-2026',
    'highest-temperature-in-los-angeles-on-july-18-2026',
  ];

  console.log('1. Hava durumu marketlerinden işlemler çekiliyor...\n');

  const walletStats = new Map<string, {
    trades: number;
    buyCount: number;
    sellCount: number;
    totalVolume: number;
    markets: Set<string>;
    avgPrice: number;
    priceSum: number;
  }>();

  // Her slug için market bul ve işlemleri çek
  for (const slug of weatherSlugs) {
    try {
      // Market bilgisini çek
      const market = await sdk.gammaApi.getMarketBySlug(slug);
      if (!market) continue;

      // İşlemleri çek
      const trades = await sdk.dataApi.getTradesByMarket(market.conditionId, 100);
      
      console.log(`   ${slug}: ${trades.length} işlem`);

      for (const trade of trades) {
        const wallet = trade.proxyWallet || trade.maker || '';
        if (!wallet) continue;

        const existing = walletStats.get(wallet) || {
          trades: 0,
          buyCount: 0,
          sellCount: 0,
          totalVolume: 0,
          markets: new Set(),
          avgPrice: 0,
          priceSum: 0,
        };

        existing.trades++;
        if (trade.side === 'BUY') existing.buyCount++;
        else existing.sellCount++;
        existing.totalVolume += (trade.size || 0) * (trade.price || 0);
        existing.markets.add(slug);
        existing.priceSum += trade.price || 0;
        existing.avgPrice = existing.priceSum / existing.trades;

        walletStats.set(wallet, existing);
      }

      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.log(`   Hata: ${slug} - ${(err as Error).message}`);
    }
  }

  console.log('\n2. Cüzdanlar analiz ediliyor...\n');

  // İstatistikleri hesapla
  const walletList = Array.from(walletStats.entries())
    .map(([addr, stats]) => ({
      address: addr,
      ...stats,
      marketCount: stats.markets.size,
      buyRatio: stats.buyCount / stats.trades,
    }))
    .filter(w => 
      w.trades >= 3 &&           // En az 3 işlem
      w.marketCount >= 2 &&      // En az 2 farklı market
      w.totalVolume >= 5         // En az $5 hacim
    )
    .sort((a, b) => {
      // Skor: çok işlem + çok market + yüksek hacim
      const scoreA = a.trades * 2 + a.marketCount * 10 + Math.log(a.totalVolume + 1);
      const scoreB = b.trades * 2 + b.marketCount * 10 + Math.log(b.totalVolume + 1);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  // Sonuçları göster
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('       EN AKTİF HAVA DURUMU CÜZDANLARI');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < walletList.length; i++) {
    const w = walletList[i];
    console.log(`#${i + 1} ${w.address}`);
    console.log(`   İşlem: ${w.trades} | Market: ${w.marketCount} | Hacim: $${w.totalVolume.toFixed(2)}`);
    console.log(`   Alım/Satım: ${w.buyCount}/${w.sellCount} (Alım oranı: ${(w.buyRatio * 100).toFixed(0)}%)`);
    console.log(`   Ort. Fiyat: $${w.avgPrice.toFixed(3)}`);
    console.log('');
  }

  // En iyi 3'ü öner
  if (walletList.length > 0) {
    const best3 = walletList.slice(0, 3);
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('       BOT İÇİN ÖNERİLEN CÜZDANLAR');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    console.log('customWallets: [');
    for (const w of best3) {
      console.log(`  '${w.address}',  // ${w.trades} işlem, ${w.marketCount} market, $${w.totalVolume.toFixed(0)} hacim`);
    }
    console.log(']');
  }

  console.log('\n=== Tamamlandı ===');
}

main().catch(console.error);
