/**
 * Güncel işlemlerden hava durumu cüzdanlarını bul
 * Gamma API + Data API kullanarak
 */

import { PolymarketSDK } from '../src/index.js';

async function main() {
  console.log('=== Hava Durumu Aktif Cüzdan Analizi ===\n');

  const sdk = await PolymarketSDK.create();

  // 1. Hava durumu marketlerini bul
  console.log('1. Hava durumu marketleri aranıyor...');
  
  const weatherMarkets = await sdk.gammaApi.getMarkets({
    closed: false,
    active: true,
    limit: 100,
  });

  // Hava durumu filtresi
  const tempMarkets = weatherMarkets.filter(m => {
    const q = (m.question || '').toLowerCase();
    return q.includes('temperature') || q.includes('highest') || 
           q.includes('lowest') || q.includes('weather') ||
           q.includes('celsius') || q.includes('fahrenheit');
  });

  console.log(`   ${tempMarkets.length} hava durumu marketi bulundu\n`);

  if (tempMarkets.length === 0) {
    console.log('Hava durumu marketi bulunamadı');
    return;
  }

  // 2. Son işlemleri çek
  console.log('2. Son işlemler çekiliyor...');
  
  const walletStats = new Map<string, {
    trades: number;
    buyCount: number;
    sellCount: number;
    totalVolume: number;
    markets: Set<string>;
    firstSeen: number;
    lastSeen: number;
  }>();

  // Her market için son işlemleri çek
  for (const market of tempMarkets.slice(0, 20)) {
    try {
      const trades = await sdk.dataApi.getTradesByMarket(market.conditionId, 50);
      
      for (const trade of trades) {
        const wallet = trade.proxyWallet || trade.maker || '';
        if (!wallet) continue;

        const existing = walletStats.get(wallet) || {
          trades: 0,
          buyCount: 0,
          sellCount: 0,
          totalVolume: 0,
          markets: new Set(),
          firstSeen: trade.timestamp,
          lastSeen: trade.timestamp,
        };

        existing.trades++;
        if (trade.side === 'BUY') existing.buyCount++;
        else existing.sellCount++;
        existing.totalVolume += (trade.size || 0) * (trade.price || 0);
        existing.markets.add(market.question || '');
        existing.firstSeen = Math.min(existing.firstSeen, trade.timestamp);
        existing.lastSeen = Math.max(existing.lastSeen, trade.timestamp);

        walletStats.set(wallet, existing);
      }

      process.stdout.write(`   ${market.question?.slice(0, 40)}... tamamlandı\r`);
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      // Hata olursa atla
    }
  }

  console.log('\n\n3. Cüzdanlar analiz ediliyor...\n');

  // 3. İstatistikleri hesapla ve sırala
  const walletList = Array.from(walletStats.entries())
    .map(([addr, stats]) => ({
      address: addr,
      ...stats,
      marketCount: stats.markets.size,
      avgTradesPerMarket: stats.trades / stats.markets.size,
      buyRatio: stats.buyCount / stats.trades,
      activityDays: (stats.lastSeen - stats.firstSeen) / (1000 * 60 * 60 * 24),
    }))
    .filter(w => 
      w.trades >= 5 &&           // En az 5 işlem
      w.marketCount >= 2 &&      // En az 2 farklı market
      w.totalVolume >= 10        // En az $10 hacim
    )
    .sort((a, b) => {
      // Skor: çok işlem + çok market + yüksek hacim
      const scoreA = a.trades * 2 + a.marketCount * 10 + Math.log(a.totalVolume + 1);
      const scoreB = b.trades * 2 + b.marketCount * 10 + Math.log(b.totalVolume + 1);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  // 4. Sonuçları göster
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('       EN AKTİF HAVA DURUMU CÜZDANLARI');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < walletList.length; i++) {
    const w = walletList[i];
    console.log(`#${i + 1} ${w.address}`);
    console.log(`   İşlem: ${w.trades} | Market: ${w.marketCount} | Hacim: $${w.totalVolume.toFixed(2)}`);
    console.log(`   Alım/Satım: ${w.buyCount}/${w.sellCount} (Alım oranı: ${(w.buyRatio * 100).toFixed(0)}%)`);
    console.log(`   Aktiflik: ${w.activityDays.toFixed(1)} gün`);
    console.log('');
  }

  // 5. En iyi 3'ü öner
  if (walletList.length > 0) {
    const best3 = walletList.slice(0, 3);
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('       BOT İÇİN ÖNERİLEN CÜZDANLAR');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    console.log('Bot config\'e eklenecekler:\n');
    console.log('customWallets: [');
    for (const w of best3) {
      console.log(`  '${w.address}',  // ${w.trades} işlem, ${w.marketCount} market, $${w.totalVolume.toFixed(0)} hacim`);
    }
    console.log(']');
    
    console.log('\nNot: Bu cüzdanlar sadece hava durumu marketlerinde aktif.');
    console.log('Bot bu cüzdanların işlemlerini kopyalayacak.');
  }

  console.log('\n=== Tamamlandı ===');
}

main().catch(console.error);
