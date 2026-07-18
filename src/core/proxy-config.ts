/**
 * Proxy Configuration
 * 
 * Cloudflare Worker proxy kullanılıyorsa URL'leri yeniden yönlendirir.
 * Worker: Bot (Render) → Worker (ABD IP) → Polymarket API
 */

const WORKER_URL = process.env.RENDER_PROXY_URL || process.env.CLOUDFLARE_WORKER_URL || '';

// Worker URL'si varsa, Polymarket URL'lerini Worker'a yönlendir
function getProxyUrl(originalUrl: string): string {
  if (!WORKER_URL) return originalUrl;
  
  // Worker URL'sini temizle
  const base = WORKER_URL.replace(/\/$/, '');
  
  // Orijinal URL'den path'i al
  const url = new URL(originalUrl);
  const path = url.pathname + url.search;
  
  // Hangi API'ye gidiyor?
  if (originalUrl.includes('clob.polymarket.com')) {
    return `${base}/clob${path}`;
  } else if (originalUrl.includes('gamma-api.polymarket.com')) {
    return `${base}/gamma${path}`;
  } else if (originalUrl.includes('data-api.polymarket.com')) {
    return `${base}/data${path}`;
  }
  
  return originalUrl;
}

// Base URL'leri
export const PROXY_CLOB_BASE = WORKER_URL 
  ? `${WORKER_URL.replace(/\/$/, '')}/clob`
  : 'https://clob.polymarket.com';

export const PROXY_GAMMA_BASE = WORKER_URL
  ? `${WORKER_URL.replace(/\/$/, '')}/gamma`
  : 'https://gamma-api.polymarket.com';

export const PROXY_DATA_BASE = WORKER_URL
  ? `${WORKER_URL.replace(/\/$/, '')}/data`
  : 'https://data-api.polymarket.com';

export { getProxyUrl, WORKER_URL };
