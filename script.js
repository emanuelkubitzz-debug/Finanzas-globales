const cryptoUrl='https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true';
const fxUrl='https://open.er-api.com/v6/latest/';

const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const num=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:4}).format(n);

async function loadCrypto(){
  try{
    const r=await fetch(cryptoUrl); if(!r.ok) throw Error();
    const d=await r.json();
    [['btcPrice','btcChange',d.bitcoin],['ethPrice','ethChange',d.ethereum],['solPrice','solChange',d.solana]].forEach(([p,c,x])=>{
      $(p).textContent=money(x.usd);
      const v=Number(x.usd_24h_change);
      $(c).textContent=(v>=0?'▲ +':'▼ ')+v.toFixed(2)+'%';
      $(c).className=v>=0?'positive':'negative';
    });
    $('updated').textContent='Última actualización: '+new Date().toLocaleTimeString();
  }catch(e){$('updated').textContent='No se pudieron cargar las cotizaciones';}
}

async function convert(){
  const amount=Number($('amount').value);
  const from=$('from').value, to=$('to').value;
  if(!Number.isFinite(amount)||amount<0){$('result').textContent='Valor inválido';return}
  try{
    const r=await fetch(fxUrl+from); if(!r.ok) throw Error();
    const d=await r.json(), rate=d.rates[to];
    if(!rate) throw Error();
    $('result').textContent=num(amount*rate)+' '+to;
    $('rate').textContent='1 '+from+' = '+num(rate)+' '+to;
  }catch(e){$('result').textContent='No disponible';$('rate').textContent='No se pudo obtener el tipo de cambio.'}
}

$('refresh').addEventListener('click',loadCrypto);
$('amount').addEventListener('input',convert);
$('from').addEventListener('change',convert);
$('to').addEventListener('change',convert);

loadCrypto();
convert();
setInterval(loadCrypto,60000);
