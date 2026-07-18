/**
 * Polymarket API credential'larını oluştur
 * Bu script'i bilgisayarında çalıştır, sonra çıkan key/secret/passphrase'i Render'a ekle
 */

import { ClobClient } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY || '0x97de0d08de514401cebb40006c2d5753b98d044dd42dc0a142a265b9b340b022';

async function main() {
  console.log('=== Polymarket API Credential Generator ===\n');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`Wallet: ${account.address}\n`);

  const signer = createWalletClient({ account, transport: http(), chain: polygon });

  const client = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
  });

  console.log('Creating API credentials...');
  const creds = await client.createOrDeriveApiKey();

  console.log('\n========================================');
  console.log('Bu değerleri Render\'a environment variable olarak ekle:');
  console.log('========================================\n');
  console.log(`RELAYER_API_KEY=${creds.key}`);
  console.log(`RELAYER_API_KEY_SECRET=${creds.secret}`);
  console.log(`RELAYER_API_KEY_PASSPHRASE=${creds.passphrase}`);
  console.log('\n========================================');
}

main().catch(console.error);
