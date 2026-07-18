/**
 * Detailed CLOB API test - check key derivation and order posting
 */
import 'dotenv/config';
import { ClobClient, Chain, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from 'ethers';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) { console.error('No private key'); process.exit(1); }

  const wallet = new Wallet(pk);
  console.log('Wallet:', wallet.address);

  // Step 1: Create L1 client
  const client = new ClobClient('https://clob.polymarket.com', Chain.POLYGON, wallet);

  // Step 2: Derive API key
  console.log('\n--- Deriving API key ---');
  try {
    const derived = await client.deriveApiKey();
    console.log('Derived key result:', JSON.stringify(derived, null, 2));
  } catch (err: any) {
    console.error('Derive error:', err.message);
  }

  // Step 3: Check API version
  console.log('\n--- Checking API ---');
  try {
    const apiVersion = await client.getApiVersion();
    console.log('API version:', apiVersion);
  } catch (err: any) {
    console.error('API version error:', err.message);
  }

  // Step 4: Create L2 client with derived credentials
  console.log('\n--- Creating L2 client ---');
  try {
    const derived = await client.deriveApiKey();
    if (!derived.key) {
      console.error('No key derived!');
      return;
    }

    const l2Client = new ClobClient(
      'https://clob.polymarket.com',
      Chain.POLYGON,
      wallet,
      { key: derived.key, secret: derived.secret, passphrase: derived.passphrase }
    );
    console.log('L2 client created with key:', derived.key.slice(0, 10) + '...');

    // Step 5: Check balance
    console.log('\n--- Checking balance ---');
    const balance = await l2Client.getBalanceAllowance({ asset_type: 'COLLATERAL' });
    console.log('Balance:', balance);

    // Step 6: Try to post a test order (small, won't fill)
    console.log('\n--- Trying to create order ---');
    try {
      // First get a token to test with - let's use a known market
      const testTokenId = '38352310116372992123977928911192323127299152605857098751973676720018570396554';
      
      // Get tick size
      const tickSize = await l2Client.getTickSize(testTokenId);
      console.log('Tick size:', tickSize);

      // Get neg risk
      const negRisk = await l2Client.getNegRisk(testTokenId);
      console.log('Neg risk:', negRisk);

      // Create order (won't post it)
      const order = await l2Client.createOrder(
        {
          tokenID: testTokenId,
          side: Side.BUY,
          price: 0.01,
          size: 5,
        },
        { tickSize, negRisk }
      );
      console.log('Order created successfully!');
      console.log('Order structure:', JSON.stringify(order, null, 2).slice(0, 500));

      // Try to post it
      console.log('\n--- Posting order ---');
      const result = await l2Client.postOrder(order, OrderType.GTC);
      console.log('Post result:', JSON.stringify(result, null, 2));

    } catch (err: any) {
      console.error('Order error:', err.message);
      if (err.response) {
        console.error('Response status:', err.response.status);
        console.error('Response data:', JSON.stringify(err.response.data, null, 2));
      }
    }

  } catch (err: any) {
    console.error('L2 client error:', err.message);
  }
}

main();
