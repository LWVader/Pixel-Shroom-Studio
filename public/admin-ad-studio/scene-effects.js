/* Deterministic effects: the same timeline position renders the same export frame. */
const MOTION_PRESETS=[
{id:'burst',name:'Breakthrough',icon:'↗',description:'Move toward the viewer and cross the post border.'},
{id:'bounce',name:'Bounce',icon:'↕',description:'Bounce out of the post with a springy landing.'},
{id:'float',name:'Float',icon:'≈',description:'Hover outside the frame with gentle swaying.'},
{id:'spin',name:'Spin',icon:'⟳',description:'Make one full turn, then return to the starting pose.'},
{id:'page-burn',name:'Page Burn',icon:'♨',description:'Char and dissolve the post with smoke, ash and rising embers.'},
{id:'explode',name:'Explode & Reset',icon:'✹',description:'Break the subject into flying tiles, then reassemble it.'},
{id:'slide',name:'Slide & Overshoot',icon:'⇥',description:'Sweep in from the side, overshoot, settle, and slide away.'},
{id:'weather',name:'Weather Rain',icon:'❄',description:'Choose snowflakes, rain, storm, petals or confetti.'},
{id:'melt',name:'Melt & Restore',icon:'⤓',description:'The scene and subject soften into long image-colored drips, then return to shape.'},
{id:'glitch',name:'Glitch & Restore',icon:'≋',description:'Split the subject into flickering strips, then restore the clean image.'}
];
const SceneEffects=(()=>{
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x)},hash=n=>{const a=Math.sin(n*127.1+311.7)*43758.5453;return a-Math.floor(a)},TAU=Math.PI*2;
function envelope(u){return ease((u-.08)/.24)*(1-ease((u-.80)/.20))}
function motion(time,state){const u=clamp(time/Number(state.duration)),base=envelope(u);let emerge=base,bob=0,angle=0;
if(state.motion==='bounce'){bob=-Math.abs(Math.sin(Math.max(0,u-.25)*TAU*2.6))*55*base;emerge=base*(1+Math.sin(u*TAU*2)*.06)}
if(state.motion==='float'){emerge=base*.9;bob=Math.sin(u*TAU*2)*25*base;angle=Math.sin(u*TAU)*.07*base}
if(state.motion==='spin')angle=TAU*ease((u-.1)/.75);
if(state.motion==='page-burn')emerge=ease((u-.25)/.28)*(1-ease((u-.85)/.15));
if(state.motion==='melt')emerge=ease((u-.22)/.27)*(1-ease((u-.82)/.18));
return{u,emerge,bob,angle}}

function burn(ctx,state,time,rect,u,e){const{x,y,w,h,edge}=rect,progress=ease((u-.08)/.65),fade=1-ease((u-.82)/.18),strength=Number(state.burnIntensity)/100;ctx.save();ctx.beginPath();ctx.rect(x-8,y,w+16,h+90);ctx.clip();ctx.globalAlpha=fade;const points=[],center=state.burnOrigin==='center',cx=x+w/2,cy=y+h*.6;
if(center){const radius=progress*w*.48;for(let i=0;i<=100;i++){const a=i/100*TAU,r=radius*(1+.06*Math.sin(a*7.2)+.03*Math.sin(a*19)+.025*Math.sin(a*31));points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r*.82])}}else{const front=edge+68-progress*(h+88);for(let i=0;i<=70;i++){const xx=x+i*w/70,rough=Math.sin(i*.65)*13+Math.sin(i*1.31)*7+Math.sin(i*2.7)*3;points.push([xx,front+rough*(.3+progress*.7)])}}
const trace=()=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(center)ctx.closePath();else{ctx.lineTo(x+w,edge+92);ctx.lineTo(x,edge+92);ctx.closePath()}};trace();const carbon=ctx.createLinearGradient(x,y,x,edge+90);carbon.addColorStop(0,'#211c17');carbon.addColorStop(.5,'#12110f');carbon.addColorStop(1,'#30251b');ctx.fillStyle=carbon;ctx.fill();ctx.save();ctx.clip();for(let i=0;i<100;i++){const xx=x+hash(i+91)*w,yy=y+hash(i+241)*(h+90);ctx.fillStyle=i%3?'#55433440':'#ac8a5e18';ctx.beginPath();ctx.ellipse(xx,yy,2+hash(i+12)*9,1+hash(i+39)*3,hash(i)*3,0,TAU);ctx.fill()}ctx.restore();
// Layered irregular paper edge: scorched brown, curled black, intermittent hot coals.
function edgeStroke(color,width,dash=[]){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(center)ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([])}
ctx.shadowColor='#0009';ctx.shadowBlur=9;edgeStroke('#6c3c20',19);ctx.shadowBlur=0;edgeStroke('#21160e',13);edgeStroke('#ae4520',5,[3,7,11,5]);ctx.shadowColor='#ff701c';ctx.shadowBlur=12*strength;edgeStroke('#e5782d',2,[6,4,2,9]);ctx.shadowBlur=0;
ctx.globalAlpha=fade;if(state.burnSmoke){for(let i=0;i<22;i++){const age=(u*1.8+hash(i+600))%1,p=points[Math.floor(hash(i+54)*(points.length-1))],xx=p[0]+Math.sin(age*5+i)*20,yy=p[1]-age*130,r=10+age*32;const g=ctx.createRadialGradient(xx,yy,1,xx,yy,r);g.addColorStop(0,`rgba(83,78,72,${.09*(1-age)*fade})`);g.addColorStop(1,'rgba(80,75,70,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(xx,yy,r,0,TAU);ctx.fill()}}
if(state.burnEmbers)for(let i=0;i<Number(state.emberAmount);i++){const age=(u*3+hash(i+200))%1,p=points[Math.floor(hash(i+50)*(points.length-1))];ctx.globalAlpha=fade*(1-age)*strength;ctx.fillStyle=i%3?'#ff8e32':'#ffd277';ctx.beginPath();ctx.arc(p[0]+Math.sin(age*4+i)*25,p[1]-age*140,1+hash(i)*2,0,TAU);ctx.fill()}ctx.restore()}
let meltLayer=null,meltSubjectLayer=null;
// Sample the real artwork: no colored overlay or molten-rock texture.
function meltProgress(u){return ease((u-.06)/.38)*(1-ease((u-.66)/.28))}
function meltImage(ctx,image,x,y,w,h,amount,maxDrop){const step=6;ctx.save();ctx.imageSmoothingEnabled=true;for(let col=0;col<w;col+=step){const cw=Math.min(step,w-col),nx=col/w,drip=(.2+.8*Math.pow(.5+.5*Math.sin(nx*TAU*5+Math.sin(nx*TAU*2)*1.8),2)),drop=amount*maxDrop*drip;
// Soften the whole image, then pull its colors into deep uneven liquid ribbons.
for(let row=0;row<16;row++){const a=row/16,b=(row+1)/16,sy=a*h,sh=(b-a)*h,dy=y+sy*(1-amount*.34)+drop*Math.pow(a,2),dh=sh*(1-amount*.34)+drop*(Math.pow(b,2)-Math.pow(a,2));ctx.drawImage(image,col,sy,cw,sh,x+col,dy,cw+.35,dh+.5)}}ctx.restore()}
function melt(ctx,state,time,rect,u){const amount=meltProgress(u,state);if(amount<.001)return;const{x,y,w,h}=rect;if(!meltLayer)meltLayer=document.createElement('canvas');if(meltLayer.width!==w||meltLayer.height!==Math.ceil(h)){meltLayer.width=w;meltLayer.height=Math.ceil(h)}const source=meltLayer.getContext('2d');source.clearRect(0,0,w,h);source.drawImage(ctx.canvas,x,y,w,h,0,0,w,h);ctx.save();ctx.fillStyle=state.cardColor;ctx.fillRect(x,y,w,h);meltImage(ctx,meltLayer,x,y,w,h,amount,h*.34+150);ctx.restore()}
function weather(ctx,state,time,rect,u,e){const{x,y,w,h}=rect,speed=Number(state.weatherSpeed)/100,wind=Number(state.weatherWind),type=state.weatherType,count=Math.round(Number(state.weatherDensity)*(type==='storm'?1.5:1));ctx.save();ctx.beginPath();ctx.rect(x-7,y,w+14,h+100);ctx.clip();ctx.globalAlpha=e;
if(type==='storm'){const flash=Math.max(0,1-Math.abs(u-.34)*90)+Math.max(0,1-Math.abs(u-.63)*90);if(flash){ctx.fillStyle=`rgba(230,245,255,${flash*.3})`;ctx.fillRect(x,y,w,h+100);ctx.strokeStyle='#f1fbff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+w*.74,y);ctx.lineTo(x+w*.64,y+90);ctx.lineTo(x+w*.7,y+100);ctx.lineTo(x+w*.53,y+200);ctx.stroke()}}
for(let i=0;i<count;i++){const z=.3+hash(i+1)*.7,age=(u*speed*(type==='rain'||type==='storm'?(type==='storm'?8:6):2.2)+hash(i+61))%1,xx=x+((hash(i+131)*w+wind*age*2+Math.sin(time*.8+i)*12+w*3)%w),yy=type==='embers'?y+(1-age)*(h+100):y+age*(h+100),size=(3+hash(i+44)*7)*z;ctx.save();ctx.translate(xx,yy);ctx.globalAlpha=e*(.4+z*.6);
if(type==='snow'){ctx.rotate(time*.4+hash(i)*TAU);ctx.strokeStyle='#eef9ff';ctx.lineWidth=Math.max(.7,size*.12);for(let a=0;a<6;a++){ctx.save();ctx.rotate(a*TAU/6);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-size);ctx.moveTo(0,-size*.65);ctx.lineTo(-size*.25,-size*.9);ctx.moveTo(0,-size*.65);ctx.lineTo(size*.25,-size*.9);ctx.stroke();ctx.restore()}}
else if(type==='rain'||type==='storm'){const g=ctx.createLinearGradient(0,-18*z,0,7*z);g.addColorStop(0,'#a9dbff00');g.addColorStop(1,'#d5edffa0');ctx.strokeStyle=g;ctx.lineWidth=1.1*z;ctx.beginPath();ctx.moveTo(-wind*.05,-20*z);ctx.lineTo(0,9*z);ctx.stroke()}
else if(type==='petals'){ctx.rotate(time+hash(i)*TAU);const g=ctx.createRadialGradient(0,-size*.2,1,0,0,size);g.addColorStop(0,'#ffe0ee');g.addColorStop(1,'#d65e99');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,size*.55,size,0,0,TAU);ctx.fill()}
else if(type==='confetti'){ctx.rotate(time*2+hash(i)*TAU);ctx.fillStyle=['#ff856e','#ffe184','#8fdbb2','#b3a0ff','#8ddcf3'][i%5];ctx.fillRect(-size*.35,-size*.65,size*.7,size*1.3)}
else{ctx.fillStyle=i%3?'#ff9b35':'#ffe695';ctx.shadowColor='#ff891c';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(0,0,size*.28,0,TAU);ctx.fill()}ctx.restore()}ctx.restore()}

function before(ctx,state,time,rect){const u=clamp(time/Number(state.duration)),e=envelope(u);if(state.motion==='page-burn'&&u>.08&&u<1)burn(ctx,state,time,rect,u,e);if(state.motion==='melt')melt(ctx,state,time,rect,u);if(state.motion==='weather'&&state.weatherLayer!=='front')weather(ctx,state,time,rect,u,e)}
function after(ctx,state,time,rect){if(state.motion==='weather'&&state.weatherLayer!=='behind'){const u=clamp(time/Number(state.duration));weather(ctx,state,time+1.2,rect,(u+.41)%1,envelope(u)*(state.weatherLayer==='both'?.6:1))}}
function subject(ctx,layer,state,time,bounds){const u=clamp(time/Number(state.duration)),e=envelope(u);ctx.save();
if(state.motion==='melt'){const amount=meltProgress(u,state);if(amount>.001){const top=Math.max(0,bounds.cy-bounds.size*.7),bottom=Math.min(layer.height,bounds.cy+bounds.size*.7),height=bottom-top;ctx.beginPath();ctx.rect(0,0,layer.width,layer.height);ctx.clip();if(!meltSubjectLayer)meltSubjectLayer=document.createElement('canvas');const crop=meltSubjectLayer;if(crop.width!==layer.width||crop.height!==Math.ceil(height)){crop.width=layer.width;crop.height=Math.ceil(height)}crop.getContext('2d').clearRect(0,0,crop.width,crop.height);crop.getContext('2d').drawImage(layer,0,top,layer.width,height,0,0,layer.width,height);meltImage(ctx,crop,0,top,layer.width,height,amount,Math.min(330,bounds.size*.65));ctx.restore();return}}
if(state.motion==='explode'){const blast=u<.52?ease((u-.27)/.25):1-ease((u-.52)/.27);if(blast>.001){const size=Math.max(bounds.size*1.12,(bounds.width||0)*1.1),objectHeight=Math.max(bounds.size*1.3,(bounds.height||0)*1.15),x=Math.max(0,bounds.cx-size/2),y=Math.max(0,bounds.cy-objectHeight/2),w=Math.min(size,layer.width-x),h=Math.min(objectHeight,layer.height-y),cols=10,rows=12,tw=w/cols,th=h/rows;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const id=r*cols+c,sx=x+c*tw,sy=y+r*th,cx=sx+tw/2,cy=sy+th/2,dx=(c-(cols-1)/2)*(25+hash(id)*24),dy=(r-(rows-1)/2)*(18+hash(id+90)*24);ctx.save();ctx.translate(cx+dx*blast,cy+dy*blast+Math.sin(blast*Math.PI)*55);ctx.rotate((hash(id+70)-.5)*blast*2.7);ctx.globalAlpha=1-blast*.13;ctx.drawImage(layer,sx,sy,tw,th,-tw/2,-th/2,tw,th);ctx.restore()}ctx.restore();return}}
if(state.motion==='slide'){const inMove=1-ease((u-.05)/.32),outMove=ease((u-.79)/.21),overshoot=Math.sin(clamp((u-.27)/.25)*Math.PI)*42;ctx.translate(-760*inMove+760*outMove+overshoot,0)}
if(state.motion==='glitch'){const intensity=(1-ease((u-.7)/.14))*e*.8,frame=Math.floor(u*45);if(intensity>.03){const bands=24,height=layer.height/bands;for(let i=0;i<bands;i++){const off=(hash(i+frame*43)-.5)*110*intensity;ctx.drawImage(layer,0,i*height,layer.width,height,off,i*height,layer.width,height);if(i%4===0&&i*height>bounds.cy-bounds.size*.6&&i*height<bounds.cy+bounds.size*.6){ctx.globalAlpha=.3*intensity;ctx.fillStyle=i%8?'#ff64c6':'#74ffe9';ctx.fillRect(bounds.cx-bounds.size*.4+off,i*height,bounds.size*.8,2);ctx.globalAlpha=1}}ctx.restore();return}}
ctx.drawImage(layer,0,0);ctx.restore()}
return{motion,before,subject,after,fireReady:()=>true};})();
