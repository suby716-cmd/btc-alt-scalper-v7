const UPBIT="https://api.upbit.com";
const BINANCE_ENDPOINTS=["https://data-api.binance.vision","https://api.binance.com","https://api1.binance.com","https://api2.binance.com","https://api3.binance.com"];
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
export default{async fetch(req,env){const u=new URL(req.url);
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
if(u.pathname==="/health")return json({ok:true,version:"v10.2.4",service:"BTC ALT REGIME TRADER v10.2.4",market:"Upbit KRW",kv:!!env.SCALPER_KV,telegramConfigured:!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID),pinConfigured:!!env.PIN,externalContext:{publicMacro:true}});
if(u.pathname==="/upbit"){const path=u.searchParams.get("path");if(!path||!path.startsWith("/v1/"))return new Response(JSON.stringify({error:"invalid path"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(UPBIT+path,{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.2"}});return new Response(await r.text(),{status:r.status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});}
if(u.pathname==="/market"){
  const raw=(u.searchParams.get("symbols")||"BTC,ETH,SOL,XRP,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR").toUpperCase().split(",").map(x=>x.trim()).filter(Boolean);
  const symbols=[...new Set(raw)].slice(0,30);
  if(!symbols.length)return json({ok:false,error:"symbols required"},400);
  const upMarkets=[...symbols.map(s=>"KRW-"+s),"KRW-USDT"].join(",");
  const fetchJson=async(url,ms=5000)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.4"},signal:c.signal);let body=null;try{body=await r.json()}catch{}return{ok:r.ok,status:r.status,body}}catch(e){return{ok:false,status:0,error:String(e?.message||e)}}finally{clearTimeout(t)}};
  const ur=await fetchJson(UPBIT+"/v1/ticker?markets="+encodeURIComponent(upMarkets),6000);
  if(!ur.ok||!Array.isArray(ur.body))return json({ok:false,error:"Upbit ticker "+ur.status},502);
  let bn=[],binanceEndpoint=null,binanceStatus=null;
  // Try ONE Binance connection at a time. data-api.binance.vision is first because
  // api.binance.com can be geo-restricted from some Cloudflare egress locations.
  // /ticker/price is much smaller than /ticker/24hr and is sufficient for Kimchi premium.
  for(const base of BINANCE_ENDPOINTS){
    const br=await fetchJson(base+"/api/v3/ticker/price",4500);binanceStatus=br.status;
    if(br.ok&&Array.isArray(br.body)){bn=br.body;binanceEndpoint=base;break}
  }
  const up=ur.body,um=new Map(up.map(x=>[x.market,x])),bm=new Map(bn.map(x=>[x.symbol,x]));
  const usdtKrw=Number(um.get("KRW-USDT")?.trade_price||0);
  const rows=symbols.map(symbol=>{const x=um.get("KRW-"+symbol)||{},b=bm.get(symbol+"USDT")||{};const price=Number(x.trade_price),ch=Number(x.signed_change_rate)*100,busdt=Number(b.price);const fair=busdt>0&&usdtKrw>0?busdt*usdtKrw:null;const premium=price>0&&fair>0?(price/fair-1)*100:null;return{symbol,price:Number.isFinite(price)?price:null,change24h:Number.isFinite(ch)?ch:null,premium:Number.isFinite(premium)?premium:null,binanceUsdt:Number.isFinite(busdt)&&busdt>0?busdt:null,fairKrw:Number.isFinite(fair)&&fair>0?fair:null,updatedAt:Number(x.timestamp)||Date.now()}});
  const priced=rows.filter(x=>Number.isFinite(x.binanceUsdt)).length;
  return json({ok:true,market:"UPBIT_KRW",reference:"Binance USDT × Upbit USDT/KRW",usdtKrw:usdtKrw||null,kimchiSourceOk:priced>0,kimchiPairs:priced,binanceEndpoint,binanceStatus,rows,updatedAt:Date.now()});
}
if(u.pathname==="/telegram-test"){if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return new Response(JSON.stringify({ok:false,message:"Worker Secret에 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하세요."}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:"⚡ BTC ALT REGIME TRADER v10.2.2\nTelegram 연결 테스트 정상입니다.\n매매는 수동으로 진행합니다."})});
const x=await r.json();return new Response(JSON.stringify({ok:!!x.ok,message:x.ok?"Telegram 테스트 메시지를 요청했습니다.":"Telegram 전송 실패"}),{status:x.ok?200:500,headers:{...cors,"Content-Type":"application/json"}});}
return new Response("BTC ALT REGIME TRADER v10.2.4",{headers:cors});}};