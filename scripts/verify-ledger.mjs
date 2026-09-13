import { loadState } from '../lib/store.mjs';

const state=await loadState();
let failed=false;
for(const user of Object.values(state.users)){
  const rows=state.ledger.filter(x=>x.userId===user.id);
  let available=0,locked=0;
  for(const tx of rows){
    if(tx.availableBefore!==available || (tx.lockedBefore??locked)!==locked){
      console.error('CHAIN_MISMATCH',user.id,tx.id,{expectedAvailable:available,actualBefore:tx.availableBefore,expectedLocked:locked,actualLockedBefore:tx.lockedBefore});failed=true;break;
    }
    available=tx.availableAfter;
    locked=tx.lockedAfter??locked;
  }
  if(available!==user.account.available||locked!==user.account.locked){console.error('ACCOUNT_MISMATCH',user.id,{ledgerAvailable:available,accountAvailable:user.account.available,ledgerLocked:locked,accountLocked:user.account.locked});failed=true;}
  else console.log('OK',user.nickname,'available',available,'locked',locked,'transactions',rows.length);
}
if(failed)process.exit(1);
