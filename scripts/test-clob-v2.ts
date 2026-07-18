/**
 * Test: clob-client-v2 with viem
 */
import 'dotenv/config';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) { console.error('No private key'); process.exit(1); }

  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log('Wallet:', account.address);

  const signer = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  // Step 1: Bootstrap client to derive API key
  const bootstrap = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
  });

  // Derive or create API key
  const apiCreds = await bootstrap.createOrDeriveApiKey();
  console.log('API Creds:', JSON.stringify(apiCreds, null, 2));

  // Step 2: Create full client with L2 auth
  const client = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
    creds: apiCreds,
    signatureType: 0, // EOA
    funderAddress: account.address,
  });

  console.log('Client created!');

  // Step 3: Test order
  const testTokenId = '38352310116372992123977928911192323127299152605857098751973676720018570396554';
  const tickSize = await client.getTickSize(testTokenId);
  const negRisk = await client.getNegRisk(testTokenId);
  console.log('Tick size:', tickSize, 'Neg risk:', negRisk);

  // Create and post order
  console.log('\n--- Creating order ---');
  try {
    const result = await client.createAndPostOrder(
      {
        tokenID: testTokenId,
        side: Side.BUY,
        price: 0.01,
        size: 5,
      },
      { tickSize, negRisk },
      OrderType.GTC,
    );
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Response:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

main();
