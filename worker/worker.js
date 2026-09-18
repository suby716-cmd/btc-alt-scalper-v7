const UPBIT="https://api.upbit.com";
const BINANCE="https://api.binance.com";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
export default{async fetch(req,env){const u=new URL(req.url);
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
if(u.pathname==="/health")return new Response(JSON.stringify({ok:true,service:"BTC ALT REGIME TRADER v10.2.2",market:"Upbit KRW"}),{headers:{...cors,"Content-Type":"application/json"}});
if(u.pathname==="/upbit"){const path=u.searchParams.get("path");if(!path||!path.startsWith("/v1/"))return new Response(JSON.stringify({error:"invalid path"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(UPBIT+path,{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.2"}});return new Response(await r.text(),{status:r.status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});}
if(u.pathname==="/market"){
  const raw=(u.searchParams.get("symbols")||"BTC,ETH,SOL,XRP,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR").toUpperCase().split(",").map(x=>x.trim()).filter(Boolean);
  const symbols=[...new Set(raw)].slice(0,30);
  if(!symbols.length)return new Response(JSON.stringify({ok:false,error:"symbols required"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  const upMarkets=[...symbols.map(s=>"KRW-"+s),"KRW-USDT"].join(',');
  const [ur,br]=await Promise.all([
    fetch(UPBIT+"/v1/ticker?markets="+encodeURIComponent(upMarkets),{headers:{"Accept":"application/json"}}),
    fetch(BINANCE+"/api/v3/ticker/24hr?symbols="+encodeURIComponent(JSON.stringify(symbols.map(s=>s+"USDT"))),{headers:{"Accept":"application/json"}})
  ]);
  if(!ur.ok) return new Response(JSON.stringify({ok:false,error:"Upbit ticker "+ur.status}),{status:502,headers:{...cors,"Content-Type":"application/json"}});
  const up=await ur.json(); const bn=br.ok?await br.json():[];
  const um=new Map(up.map(x=>[x.market,x])), bm=new Map((Array.isArray(bn)?bn:[]).map(x=>[x.symbol,x]));
  const usdtKrw=Number(um.get("KRW-USDT")?.trade_price||0);
  const rows=symbols.map(symbol=>{const x=um.get("KRW-"+symbol)||{},b=bm.get(symbol+"USDT")||{};const price=Number(x.trade_price);const ch=Number(x.signed_change_rate)*100;const busdt=Number(b.lastPrice);const fair=busdt>0&&usdtKrw>0?busdt*usdtKrw:null;const premium=price>0&&fair>0?(price/fair-1)*100:null;return {symbol,price:Number.isFinite(price)?price:null,change24h:Number.isFinite(ch)?ch:null,premium:Number.isFinite(premium)?premium:null,binanceUsdt:Number.isFinite(busdt)?busdt:null,fairKrw:Number.isFinite(fair)?fair:null,updatedAt:Number(x.timestamp)||Date.now()};});
  return new Response(JSON.stringify({ok:true,market:"UPBIT_KRW",reference:"Binance USDT × Upbit USDT/KRW",usdtKrw:usdtKrw||null,rows,updatedAt:Date.now()}),{headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
}
if(u.pathname==="/telegram-test"){if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return new Response(JSON.stringify({ok:false,message:"Worker Secret에 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하세요."}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:"⚡ BTC ALT REGIME TRADER v10.2.2\nTelegram 연결 테스트 정상입니다.\n매매는 수동으로 진행합니다."})});
const x=await r.json();return new Response(JSON.stringify({ok:!!x.ok,message:x.ok?"Telegram 테스트 메시지를 요청했습니다.":"Telegram 전송 실패"}),{status:x.ok?200:500,headers:{...cors,"Content-Type":"application/json"}});}
return new Response("BTC ALT REGIME TRADER v10.2.2",{headers:cors});}};
