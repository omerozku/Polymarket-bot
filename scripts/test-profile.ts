import 'dotenv/config';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { ClobClient } from '@polymarket/clob-client-v2';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY!;
  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log('EOA:', account.address);

  const signer = createWalletClient({ account, chain: polygon, transport: http() });
  
  const client = new ClobClient({ host: 'https://clob.polymarket.com', chain: 137, signer });
  const creds = await client.createOrDeriveApiKey();
  console.log('Creds:', JSON.stringify(creds));
  
  const l2 = new ClobClient({ 
    host: 'https://clob.polymarket.com', 
    chain: 137, 
    signer, 
    creds, 
    signatureType: 0,
  });
  
  // Check profile
  try {
    const profile = await l2.getProfile();
    console.log('Profile:', JSON.stringify(profile));
  } catch(e: any) {
    console.log('Profile err:', e.message);
  }
  
  // Check positions
  try {
    const positions = await l2.getUserPositions();
    console.log('Positions:', JSON.stringify(positions).slice(0, 500));
  } catch(e: any) {
    console.log('Positions err:', e.message);
  }
}

main();
