const UPBIT="https://api.upbit.com";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
export default{async fetch(req,env){const u=new URL(req.url);
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
if(u.pathname==="/health")return json({ok:true,version:"v10.2.4.4",service:"BTC ALT REGIME TRADER v10.2.4.4",market:"Upbit KRW",kv:!!env.SCALPER_KV,telegramConfigured:!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID),pinConfigured:!!env.PIN,externalContext:{publicMacro:true}});
if(u.pathname==="/upbit"){const path=u.searchParams.get("path");if(!path||!path.startsWith("/v1/"))return new Response(JSON.stringify({error:"invalid path"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(UPBIT+path,{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.2"}});return new Response(await r.text(),{status:r.status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});}
if(u.pathname==="/market"){
  const symbols=(u.searchParams.get("symbols")||"BTC,ETH,SOL,XRP,XLM,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR").toUpperCase().split(",").map(x=>x.trim()).filter(Boolean);
  const uniq=[...new Set(symbols)].slice(0,30);
  const upMarkets=[...new Set([...uniq.map(s=>"KRW-"+s),"KRW-USDT"])];
  const fetchJson=async(url,ms=5000)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.4.4"},signal:c.signal});let body=null;try{body=await r.json()}catch{}return{ok:r.ok,status:r.status,body}}catch(e){return{ok:false,status:0,error:String(e?.message||e)}}finally{clearTimeout(t)}};
  const ur=await fetchJson(UPBIT+"/v1/ticker?markets="+encodeURIComponent(upMarkets.join(",")),5000);
  if(!ur.ok||!Array.isArray(ur.body))return json({ok:false,version:"v10.2.4.4",error:"UPBIT_FAILED",status:ur.status,detail:ur.error||null},502);
  const up=ur.body,um=new Map(up.map(x=>[x.market,x]));
  const usdtKrw=Number(um.get("KRW-USDT")?.trade_price)||0;

  // Overseas reference: CryptoCompare multi-symbol endpoint.
  // One request returns all requested USD prices, reducing rate-limit/connection pressure.
  let refMap=new Map(),referenceSource=null,referenceStatus=null;
  const cr=await fetchJson("https://min-api.cryptocompare.com/data/pricemulti?fsyms="+encodeURIComponent(uniq.join(","))+"&tsyms=USD",5000);
  referenceStatus=cr.status;
  if(cr.ok&&cr.body&&typeof cr.body==="object"){
    for(const s of uniq){const p=Number(cr.body?.[s]?.USD);if(Number.isFinite(p)&&p>0)refMap.set(s,p)}
    if(refMap.size)referenceSource="CryptoCompare USD";
  }

  // Second independent fallback: Coinbase public spot endpoint.
  // Called sequentially only for symbols missing from the primary reference.
  let coinbaseStatus=null;
  if(refMap.size<uniq.length){
    for(const s of uniq){
      if(refMap.has(s))continue;
      const cb=await fetchJson("https://api.coinbase.com/v2/prices/"+encodeURIComponent(s)+"-USD/spot",3500);
      coinbaseStatus=cb.status;
      const p=Number(cb.body?.data?.amount);
      if(cb.ok&&Number.isFinite(p)&&p>0)refMap.set(s,p);
    }
    if(refMap.size&&!referenceSource)referenceSource="Coinbase USD";
    else if(refMap.size)referenceSource+=" + Coinbase fallback";
  }

  const rows=uniq.map(symbol=>{
    const x=um.get("KRW-"+symbol),price=Number(x?.trade_price)||null;
    const change24h=Number.isFinite(Number(x?.signed_change_rate))?Number(x.signed_change_rate)*100:null;
    const overseasUsd=refMap.get(symbol)||null;
    const fairKrw=overseasUsd&&usdtKrw?overseasUsd*usdtKrw:null;
    const premium=price&&fairKrw?((price/fairKrw)-1)*100:null;
    return{symbol,price,change24h,premium,overseasUsd,fairKrw,updatedAt:x?.timestamp||null}
  });
  const priced=rows.filter(r=>Number.isFinite(r.premium)).length;
  return json({ok:true,version:"v10.2.4.4",market:"UPBIT_KRW",reference:(referenceSource||"NONE")+" × Upbit USDT/KRW",referenceSource,referenceStatus,coinbaseStatus,usdtKrw:usdtKrw||null,kimchiSourceOk:priced>0,kimchiPairs:priced,rows,updatedAt:Date.now()});
}
if(u.pathname==="/telegram-test"){if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return new Response(JSON.stringify({ok:false,message:"Worker Secret에 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하세요."}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:"⚡ BTC ALT REGIME TRADER v10.2.2\nTelegram 연결 테스트 정상입니다.\n매매는 수동으로 진행합니다."})});
const x=await r.json();return new Response(JSON.stringify({ok:!!x.ok,message:x.ok?"Telegram 테스트 메시지를 요청했습니다.":"Telegram 전송 실패"}),{status:x.ok?200:500,headers:{...cors,"Content-Type":"application/json"}});}
return new Response("BTC ALT REGIME TRADER v10.2.4.4",{headers:cors});}};
