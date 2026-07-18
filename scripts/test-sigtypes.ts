import 'dotenv/config';
import { ClobClient } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

const pk = process.env.POLYMARKET_PRIVATE_KEY!;
const account = privateKeyToAccount(pk as `0x${string}`);
console.log('EOA:', account.address);

const signer = createWalletClient({ account, chain: polygon, transport: http() });

const client = new ClobClient({ host: 'https://clob.polymarket.com', chain: 137, signer });
const creds = await client.createOrDeriveApiKey();

// Try different signatureTypes to see which one works
for (const sigType of [0, 1, 2, 3]) {
  console.log(`\n--- Testing signatureType=${sigType} ---`);
  const l2 = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
    creds,
    signatureType: sigType,
    funderAddress: account.address,
  });

  try {
    const result = await l2.createAndPostOrder(
      {
        tokenID: '38352310116372992123977928911192323127299152605857098751973676720018570396554',
        side: 0 as any,
        price: 0.01,
        size: 5,
      },
      { tickSize: '0.001', negRisk: true },
    );
    console.log('SUCCESS:', JSON.stringify(result));
    break;
  } catch (err: any) {
    console.log('Error:', err.message || JSON.stringify(err));
  }
}
