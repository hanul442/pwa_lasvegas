let ctx=null,source=null,timer=null,enabled=true;

function context(){
  if(ctx){if(ctx.state==='suspended')ctx.resume().catch(()=>{});return ctx;}
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx)return null;
  ctx=new Ctx();
  if(ctx.state==='suspended')ctx.resume().catch(()=>{});
  return ctx;
}

function tone(freq=520,duration=.06,gain=.02){
  const c=context();
  if(!c||!enabled)return;
  const osc=c.createOscillator(),g=c.createGain();
  osc.frequency.setValueAtTime(freq,c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(80,freq*.75),c.currentTime+duration);
  g.gain.setValueAtTime(gain,c.currentTime);
  g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+duration);
  osc.connect(g).connect(c.destination);osc.start();osc.stop(c.currentTime+duration);
}

function chimeLoop(){
  clearTimeout(timer);
  if(!enabled||!ctx)return;
  timer=setTimeout(()=>{tone(950+Math.random()*380,.16,.007);chimeLoop()},5000+Math.random()*7000);
}

function start(){
  const c=context();
  if(!c||!enabled||source)return;
  const length=Math.floor(c.sampleRate*2),buffer=c.createBuffer(1,length,c.sampleRate),data=buffer.getChannelData(0);
  let last=0;
  for(let i=0;i<length;i++){last=last*.985+(Math.random()*2-1)*.015;data[i]=last;}
  const src=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
  src.buffer=buffer;src.loop=true;filter.type='bandpass';filter.frequency.value=520;filter.Q.value=.35;gain.gain.value=.016;
  src.connect(filter).connect(gain).connect(c.destination);src.start();source=src;chimeLoop();
}

function stop(){clearTimeout(timer);timer=null;if(source){try{source.stop()}catch{}source.disconnect();source=null}}
function toggle(){enabled=!enabled;if(enabled)start();else stop();return enabled}
function deal(count=1){for(let i=0;i<Math.min(10,count);i++)setTimeout(()=>tone(720-(i%5)*35,.045,.014),i*60)}
function chip(){tone(290,.07,.024)}
function win(){[660,880,1100].forEach((f,i)=>setTimeout(()=>tone(f,.13,.038),i*90))}

export const casinoAudio={start,stop,toggle,deal,chip,win,get enabled(){return enabled}};
