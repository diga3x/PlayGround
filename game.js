import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';

// NIGHTFALL — a compact, touch-first tactical FPS built from procedural geometry.
const canvas = document.querySelector('#game');
const $ = (s) => document.querySelector(s);
const ui = {
  menu: $('#menu'), hud: $('#hud'), result: $('#round-result'), pause: $('#pause-screen'),
  deploy: $('#deploy-btn'), next: $('#next-round'), resume: $('#resume-btn'),
  timer: $('#timer'), round: $('#round-num'), state: $('#round-state'),
  blue: $('#score-blue'), red: $('#score-red'), health: $('#health-value'), healthBar: $('#health-bar'),
  ammo: $('#ammo-value'), reserve: $('#reserve-value'), ammoBar: $('#ammo-bar'),
  resultTitle: $('#result-title'), resultCopy: $('#result-copy'), resultRound: $('#result-round'),
  resultKills: $('#result-kills'), resultAccuracy: $('#result-accuracy'), resultHealth: $('#result-health'),
  crosshair: $('#crosshair'), hit: $('#hit-marker'), feed: $('#killfeed'), toast: $('#toast'),
  damage: $('#damage-flash'), reloadStatus: $('#reload-status'), joy: $('#joystick'), knob: $('#joy-knob'),
  fire: $('#fire-btn'), reload: $('#reload-btn'), sprint: $('#sprint-btn'),
};

let renderer, scene, camera, clock, weapon, muzzleFlash, raycaster;
let running = false, paused = false, roundOver = false;
let round = 1, scoreBlue = 0, scoreRed = 0, roundTime = 105;
let health = 100, ammo = 30, reserveAmmo = 90, reloadTimer = 0, fireTimer = 0;
let shotsFired = 0, shotsHit = 0, kills = 0, recoil = 0, walkPhase = 0, damageFlashTimer = 0;
let enemies = [], bullets = [], decor = [], keys = Object.create(null);
const input = { x: 0, y: 0, firing: false, sprinting: false, pointerId: null, lookId: null, lastX: 0, lastY: 0 };
const player = { pos: new THREE.Vector3(-19, 1.7, 17), yaw: 0.62, pitch: 0, speed: 5.2, alive: true };
const ARENA = { x: 29, z: 24 };
const mat = (color, roughness = .8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9a28d');
  scene.fog = new THREE.FogExp2('#a9a28d', 0.012);
  camera = new THREE.PerspectiveCamera(73, innerWidth / innerHeight, .08, 125);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  buildLighting();
  buildArena();
  buildWeapon();
  wireInput();
  window.addEventListener('resize', resize);
  $('#control-hint').textContent = isTouch() ? 'LEFT STICK MOVE · DRAG TO LOOK' : 'WASD MOVE · MOUSE AIM · CLICK FIRE';
  ui.deploy.addEventListener('click', startGame);
  ui.next.addEventListener('click', nextRound);
  ui.resume.addEventListener('click', resumeGame);
  $('#reload-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); reload(); });
  $('#sprint-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); input.sprinting = true; });
  $('#sprint-btn').addEventListener('pointerup', () => input.sprinting = false);
  $('#sprint-btn').addEventListener('pointercancel', () => input.sprinting = false);
  $('#fire-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); input.firing = true; ui.fire.classList.add('active'); tryShoot(); });
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) $('#fire-btn').addEventListener(event, () => { input.firing = false; ui.fire.classList.remove('active'); });
  animate();
}

function buildLighting() {
  scene.add(new THREE.HemisphereLight('#cfddd1', '#423d34', 1.15));
  const sun = new THREE.DirectionalLight('#ffe0ad', 3.2);
  sun.position.set(-23, 36, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.bias = -.00035;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#8eaeb2', .85);
  fill.position.set(20, 12, -20); scene.add(fill);
  const warm = new THREE.PointLight('#f0a26a', 13, 30, 2);
  warm.position.set(4, 5, -12); scene.add(warm);
}

const obstacles = [];
const blockerMeshes = [];
function box(name, x, y, z, sx, sy, sz, material, collision = false, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true;
  scene.add(mesh);
  if (collision) { obstacles.push({ x, z, hx: sx / 2, hz: sz / 2 }); blockerMeshes.push(mesh); }
  return mesh;
}
function cylinder(x, y, z, rTop, rBottom, h, material, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
}
function makeGroundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#77766a'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const v = 78 + Math.random() * 62;
    ctx.fillStyle = `rgba(${v},${v * .98},${v * .88},${Math.random() * .14})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }
  ctx.strokeStyle = 'rgba(27,34,32,.16)'; ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
  for (let y = 0; y <= 512; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(8, 7); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function buildArena() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 62), new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.12; ground.receiveShadow = true; scene.add(ground);
  const concrete = mat('#77776d'), dark = mat('#454a45'), faded = mat('#a69c83'), rust = mat('#8d5943'), hazard = mat('#d5b755');
  const wall = mat('#686d63'), containerBlue = mat('#526a6a'), containerRed = mat('#755748');
  // The perimeter is deliberately broken into sightlines and waist-high cover.
  box('back warehouse', 4, 5, -25, 30, 10, 2, wall, true);
  box('back facade', -13, 5, -18.5, 2, 10, 11, dark, true);
  box('left perimeter', -30, 4, 0, 2, 8, 52, concrete, true);
  box('right perimeter', 30, 4, -1, 2, 8, 50, concrete, true);
  box('south wall west', -23, 3.5, 25, 14, 7, 2, concrete, true);
  box('south wall east', 23, 3.5, 25, 14, 7, 2, concrete, true);
  box('perimeter cap west', -29, 8.15, 0, 2.2, .3, 52, faded, false);
  box('perimeter cap east', 29, 8.15, -1, 2.2, .3, 50, faded, false);
  // Warehouse trim, loading bays, and industrial ribs.
  for (let x = -8; x <= 16; x += 4) {
    box('warehouse rib', x, 5, -23.88, .18, 9.5, .15, faded, false);
  }
  for (let x of [-5, 4, 13]) {
    box('loading door', x, 2.7, -23.92, 3.7, 5.3, .11, dark, false);
    for (let y = .4; y < 5; y += .8) box('door slat', x, y, -23.83, 3.2, .045, .05, faded, false, false);
    box('door lintel', x, 5.45, -23.7, 4.2, .2, .38, rust, false);
  }
  // Tall shipping containers create long competitive lanes.
  const container = (x, z, material, sx = 8) => {
    box('shipping container', x, 2.05, z, sx, 4.1, 3.1, material, true);
    for (let dx = -sx / 2 + .35; dx < sx / 2; dx += .48) box('container corrugation', x + dx, 2.05, z + 1.58, .08, 3.9, .07, mat('#8d9183'), false, false);
    box('container top edge', x, 4.13, z, sx + .1, .13, 3.2, faded, false);
    box('container corner', x - sx / 2 + .18, 2, z + 1.64, .3, 4, .18, dark, false);
    box('container corner', x + sx / 2 - .18, 2, z + 1.64, .3, 4, .18, dark, false);
  };
  container(-16, -8, containerBlue, 9);
  container(15, 8, containerRed, 9);
  // Stacked cargo and low tactical cover.
  box('cargo stack', -2, 1.35, -10, 5.4, 2.7, 3.5, faded, true);
  box('cargo top', -2, 2.78, -10, 5.55, .16, 3.6, dark, false);
  box('low crate west', -13, .78, 7, 3.4, 1.55, 2.8, rust, true);
  box('crate lid west', -13, 1.58, 7, 3.55, .12, 2.95, faded, false);
  box('low crate center', 2, .68, 3, 3, 1.35, 2.4, concrete, true);
  box('crate lid center', 2, 1.38, 3, 3.15, .12, 2.5, faded, false);
  box('low crate east', 22, .9, -1, 3.3, 1.8, 3.1, dark, true);
  box('cover block north', 10, .62, -5, 2.8, 1.25, 2, faded, true);
  box('cover block south', -5, .65, 15, 3, 1.3, 2.5, dark, true);
  // Site A marking, painted perimeter, and a practical objective prop.
  const site = new THREE.Mesh(new THREE.CircleGeometry(5.2, 48), new THREE.MeshBasicMaterial({ color: '#b8a75e', transparent: true, opacity: .14, side: THREE.DoubleSide }));
  site.rotation.x = -Math.PI / 2; site.position.set(8, -.015, -11); scene.add(site);
  for (const [x, z, sx, sz] of [[8,-16.2,10.4,.11],[8,-5.8,10.4,.11],[2.8,-11,.11,10.4],[13.2,-11,.11,10.4]]) box('site stripe',x,.01,z,sx,.025,sz,hazard,false,false);
  box('objective terminal', 8, .65, -11, .65, 1.3, .5, dark, true);
  box('terminal face', 8, .83, -10.73, .45, .55, .035, mat('#a8ce83', .45, .15), false, false);
  // Barrels, bollards, cable drums, lamps and scattered field details.
  for (const [x,z] of [[-21,-16],[-20,12],[24,14],[18,-18]]) {
    cylinder(x,.75,z,.62,.68,1.5,rust,14);
    cylinder(x,1.52,z,.61,.61,.08,dark,14);
    box('barrel band',x,.45,z,1.25,.12,1.25,hazard,false,false);
  }
  for (const [x,z] of [[-9,-3],[17,-3],[-1,-18],[21,19]]) {
    cylinder(x,.9,z,.8,.8,1.8,mat('#777970'),12);
    cylinder(x,1.85,z,.76,.76,.12,dark,12);
    cylinder(x,1.95,z,.58,.58,.08,faded,12);
  }
  // Concrete anti-vehicle teeth and floor markings.
  for (let x = -24; x <= 24; x += 4) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.42,.85,5), concrete);
    cone.position.set(x,.43,21.5); cone.castShadow = true; scene.add(cone);
  }
  for (const [x,z] of [[-24,-20],[23,-20],[-25,18],[25,18]]) {
    box('lamp post',x,4,z,.15,8,.15,dark,false);
    box('lamp arm',x + (x < 0 ? 1 : -1),7.8,z,.8,.12,.12,dark,false);
    const lamp = new THREE.PointLight('#edc38c',8,12,2); lamp.position.set(x + (x < 0 ? 1 : -1),7.4,z); scene.add(lamp);
    box('lamp fixture',lamp.position.x,7.35,z,.5,.18,.32,mat('#d9c79d'),false);
  }
  // Small warning boards and paint stripes add scale cues.
  for (const [x,z] of [[-13,-15],[19,19],[24,-12]]) {
    box('warning board',x,2.1,z,1.5,.75,.08,hazard,false);
    box('warning text',x,2.1,z+.055,.65,.1,.025,dark,false,false);
  }
}

function buildWeapon() {
  weapon = new THREE.Group();
  const graphite = mat('#202724', .36, .65), polymer = mat('#39423c', .65, .05), steel = mat('#778079', .3, .75), accent = mat('#d4e5ac', .3, .25);
  const addBox = (parent, x,y,z,sx,sy,sz,material) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),material); m.position.set(x,y,z); parent.add(m); return m; };
  // Compact carbine view model; geometry is attached to the camera for stable mobile framing.
  addBox(weapon, 0, -.01, -.03, .17, .15, .55, graphite);
  addBox(weapon, 0, .06, -.06, .12, .07, .27, polymer);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,.43,10),steel); barrel.rotation.x = Math.PI/2; barrel.position.set(0,.015,-.47); weapon.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.08,10),graphite); muzzle.rotation.x=Math.PI/2; muzzle.position.set(0,.015,-.68); weapon.add(muzzle);
  addBox(weapon,0,.135,-.12,.07,.07,.16,graphite);
  addBox(weapon,0,.195,-.11,.04,.045,.12,accent);
  addBox(weapon,0,-.17,.08,.105,.25,.13,polymer).rotation.x=-.18;
  addBox(weapon,.11,-.045,-.06,.07,.09,.21,polymer).rotation.z=-.13;
  addBox(weapon,-.1,-.005,-.12,.035,.14,.12,steel);
  // Tiny rail slots and front sight.
  for(let z=-.12;z>-.5;z-=.065) addBox(weapon,0,.105,z,.065,.016,.018,steel);
  addBox(weapon,0,.12,-.55,.026,.07,.03,graphite);
  muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(.1,.34,7),new THREE.MeshBasicMaterial({color:'#ffd47e',transparent:true,opacity:.9}));
  muzzleFlash.rotation.x=-Math.PI/2; muzzleFlash.position.set(0,.015,-.9); muzzleFlash.visible=false; weapon.add(muzzleFlash);
  weapon.position.set(.32,-.27,-.55); camera.add(weapon);
}

const enemyMaterials = [mat('#5f4036'),mat('#494f48'),mat('#594a3a'),mat('#57443f')];
const enemyMetal = mat('#252b29',.4,.4);
function spawnEnemy(index) {
  const group = new THREE.Group();
  const color = enemyMaterials[index % enemyMaterials.length];
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28,.65,4,8),color); body.position.y=1.04; body.castShadow=true; group.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(.61,.47,.3),mat(index%2?'#3e4942':'#51473c')); vest.position.set(0,1.12,-.015); vest.castShadow=true; group.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.22,12,10),mat('#b28e70')); head.position.y=1.67; head.castShadow=true; group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.245,12,7,0,Math.PI*2,0,Math.PI*.56),mat(index%2?'#455148':'#675442')); helmet.position.y=1.74; helmet.castShadow=true; group.add(helmet);
  const legMat=mat('#343a35');
  for(const x of [-.16,.16]){const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.11,.47,3,7),legMat);leg.position.set(x,.39,0);leg.castShadow=true;group.add(leg);}
  for(const x of [-.37,.37]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.4,3,7),color);arm.position.set(x,1.14,-.02);arm.rotation.z=x<0?-.2:.2;arm.rotation.x=-.25;arm.castShadow=true;group.add(arm);}
  const rifle=new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.72),enemyMetal);rifle.position.set(.13,.96,-.42);rifle.castShadow=true;group.add(rifle);
  const scope=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,.15),mat('#a3ad9c',.4,.3));scope.position.set(.13,1.04,-.35);group.add(scope);
  const flash=new THREE.Mesh(new THREE.SphereGeometry(.1,6,5),new THREE.MeshBasicMaterial({color:'#ffc36c'}));flash.position.set(.13,.96,-.82);flash.visible=false;group.add(flash);
  group.position.set(0,0,0); scene.add(group);
  const angles=[-.1,.95,2.1,3.0,-2.1,-.9,1.75];
  const angle=angles[index%angles.length], radius=18+(index%3)*3;
  const x=Math.cos(angle)*radius, z=Math.sin(angle)*radius;
  group.position.set(x,0,z);
  const enemy={group,parts:group.children.filter(c=>c.isMesh),flash,health:100,alive:true,shoot:2.2+Math.random()*1.2,speed:1.15+Math.random()*.45,strafe:Math.random()<.5?-1:1,hit:0,index};
  enemies.push(enemy); return enemy;
}

function startGame() {
  ui.menu.classList.add('hidden'); ui.result.classList.add('hidden'); ui.hud.classList.remove('hidden');
  running=true; paused=false; roundOver=false; health=100; ammo=30; reserveAmmo=90; kills=0; shotsFired=0; shotsHit=0; roundTime=105;
  player.alive=true; player.pos.set(-19,1.7,17); player.yaw=-.84; player.pitch=0;
  clearEnemies(); for(let i=0;i<5;i++) spawnEnemy(i);
  if(!isTouch() && canvas.requestPointerLock) canvas.requestPointerLock();
  showToast(`ROUND ${String(round).padStart(2,'0')} — MOVE OUT`);
  updateHud();
}
function clearEnemies(){ for(const e of enemies)scene.remove(e.group); enemies=[]; for(const b of bullets)scene.remove(b.line); bullets=[]; }
function nextRound(){ round++; startGame(); }
function endRound(won){
  if(roundOver)return; roundOver=true; running=false; input.firing=false;
  if(document.pointerLockElement)document.exitPointerLock();
  if(won)scoreBlue++;else scoreRed++;
  ui.blue.textContent=scoreBlue;ui.red.textContent=scoreRed;
  ui.hud.classList.add('hidden');ui.result.classList.remove('hidden');
  ui.resultTitle.innerHTML=won?'SECTOR<br><em>SECURED.</em>':'MISSION<br><em>COMPROMISED.</em>';
  ui.resultCopy.textContent=won?'Hostile presence neutralized. Perimeter is secure.':(health<=0?'Operator down. Regroup and redeploy.':'Hostiles held the sector. Regroup and redeploy.');
  ui.resultRound.textContent=String(round).padStart(2,'0');ui.resultKills.textContent=`${kills}/${5+Math.floor((round-1)*.5)}`;
  ui.resultAccuracy.textContent=`${shotsFired?Math.round(shotsHit/shotsFired*100):0}%`;ui.resultHealth.textContent=Math.max(0,health);
  ui.next.querySelector('span').textContent=scoreBlue>=5?'DEPLOY — FINAL PUSH':'CONTINUE OPERATION';
  if(scoreBlue>=5||scoreRed>=5){scoreBlue=0;scoreRed=0;round=0;ui.blue.textContent='0';ui.red.textContent='0';}
}
function pauseGame(){if(!running||paused||isTouch())return;paused=true;running=false;ui.pause.classList.remove('hidden');if(document.pointerLockElement)document.exitPointerLock();}
function resumeGame(){paused=false;running=true;ui.pause.classList.add('hidden');if(!isTouch()&&canvas.requestPointerLock)canvas.requestPointerLock();clock.getDelta();}
function showToast(text){ui.toast.textContent=text;ui.toast.classList.add('show');clearTimeout(showToast.timeout);showToast.timeout=setTimeout(()=>ui.toast.classList.remove('show'),1700);}
function isTouch(){return matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;}

let audioCtx=null;
function soundShot(volume=.08,frequency=85){
  try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();
    const now=audioCtx.currentTime,osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
    osc.type='sawtooth';osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(35,now+.07);
    gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+.09);
    osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now);osc.stop(now+.1);
  }catch(_){/* Audio is optional; the operation remains fully playable. */}
}
function wireInput(){
  document.addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    if(e.code==='KeyR')reload();
    if(e.code==='Escape'){if(running)pauseGame();else if(paused)resumeGame();}
    if(e.code==='ShiftLeft'||e.code==='ShiftRight')input.sprinting=true;
  });
  document.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='ShiftLeft'||e.code==='ShiftRight')input.sprinting=false;});
  canvas.addEventListener('mousedown',e=>{if(e.button===0&&running&&!isTouch()){input.firing=true;tryShoot();}});
  window.addEventListener('mouseup',()=>input.firing=false);
  document.addEventListener('mousemove',e=>{
    if(document.pointerLockElement===canvas&&running){player.yaw-=e.movementX*.0022;player.pitch=Math.max(-1.35,Math.min(1.35,player.pitch-e.movementY*.0019));}
  });
  canvas.addEventListener('click',()=>{if(running&&!isTouch()&&document.pointerLockElement!==canvas)canvas.requestPointerLock?.();});
  const joy=ui.joy, knob=ui.knob;
  joy.addEventListener('pointerdown',e=>{e.preventDefault();input.pointerId=e.pointerId;joy.setPointerCapture(e.pointerId);updateJoystick(e);});
  joy.addEventListener('pointermove',e=>{if(input.pointerId===e.pointerId)updateJoystick(e);});
  const releaseJoy=e=>{if(input.pointerId===e.pointerId){input.pointerId=null;input.x=0;input.y=0;knob.style.transform='translate(0px,0px)';}};
  joy.addEventListener('pointerup',releaseJoy);joy.addEventListener('pointercancel',releaseJoy);
  const look=$('#look-zone');
  look.addEventListener('pointerdown',e=>{if(!running)return;e.preventDefault();input.lookId=e.pointerId;input.lastX=e.clientX;input.lastY=e.clientY;look.setPointerCapture(e.pointerId);});
  look.addEventListener('pointermove',e=>{if(input.lookId!==e.pointerId)return;const dx=e.clientX-input.lastX,dy=e.clientY-input.lastY;input.lastX=e.clientX;input.lastY=e.clientY;player.yaw-=dx*.006;player.pitch=Math.max(-1.25,Math.min(1.25,player.pitch-dy*.005));});
  const releaseLook=e=>{if(input.lookId===e.pointerId)input.lookId=null;};look.addEventListener('pointerup',releaseLook);look.addEventListener('pointercancel',releaseLook);
}
function updateJoystick(e){
  const r=ui.joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy;
  const max=r.width*.36,d=Math.hypot(dx,dy),scale=d>max?max/d:1;
  const x=dx*scale,y=dy*scale;input.x=x/max;input.y=y/max;
  ui.knob.style.transform=`translate(${x}px,${y}px)`;
}
function moveAgainstWalls(pos,dx,dz,radius=.42){
  let nx=Math.max(-27.7,Math.min(27.7,pos.x+dx)),nz=Math.max(-22.2,Math.min(22.2,pos.z+dz));
  for(const o of obstacles){
    const px=nx-o.x,pz=nz-o.z,cx=Math.max(-o.hx-radius,Math.min(o.hx+radius,px)),cz=Math.max(-o.hz-radius,Math.min(o.hz+radius,pz));
    const ox=px-cx,oz=pz-cz;if(ox*ox+oz*oz<radius*radius){
      if(Math.abs(ox)>Math.abs(oz))nx=o.x+cx+Math.sign(ox||1)*radius;
      else nz=o.z+cz+Math.sign(oz||1)*radius;
    }
  }
  pos.x=nx;pos.z=nz;
}
function tryShoot(){
  if(!running||roundOver||reloadTimer>0||fireTimer>0)return;
  if(ammo<=0){reload();return;}
  ammo--;shotsFired++;fireTimer=.115;recoil=Math.min(.14,recoil+.055);
  muzzleFlash.visible=true;muzzleFlash.material.opacity=.95;ui.crosshair.classList.add('firing');setTimeout(()=>ui.crosshair.classList.remove('firing'),65);
  soundShot(.065,70+Math.random()*22);
  camera.updateMatrixWorld(true);
  const direction=new THREE.Vector3();camera.getWorldDirection(direction);raycaster.set(camera.position,direction);raycaster.far=70;
  const wallHits=raycaster.intersectObjects(blockerMeshes,false),wallDist=wallHits.length?wallHits[0].distance:70;
  let best=null,bestDist=wallDist;
  const targets=[];for(const e of enemies)if(e.alive)targets.push(...e.parts);
  const hits=raycaster.intersectObjects(targets,false);
  if(hits.length&&hits[0].distance<bestDist){best=enemies.find(e=>e.parts.includes(hits[0].object));bestDist=hits[0].distance;}
  const start=new THREE.Vector3();muzzleFlash.getWorldPosition(start);
  const end=best?hits[0].point.clone():camera.position.clone().addScaledVector(direction,Math.max(4,Math.min(wallDist,32)));
  makeTracer(start,end);
  if(best){
    shotsHit++;const headshot=hits[0].point.y>best.group.position.y+1.48;best.health-=headshot?100:43;best.hit=.12;
    ui.hit.classList.add('show');setTimeout(()=>ui.hit.classList.remove('show'),100);
    if(best.health<=0)killEnemy(best,headshot);
  }
  updateHud();
}
function makeTracer(start,end){
  const geometry=new THREE.BufferGeometry().setFromPoints([start,end]);
  const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:'#f9e3a8',transparent:true,opacity:.8}));scene.add(line);bullets.push({line,life:.07,max:.07});
}
function killEnemy(enemy,headshot){
  if(!enemy.alive)return;enemy.alive=false;kills++;
  enemy.group.rotation.z=-.9;enemy.group.position.y=.12;enemy.group.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.color.multiplyScalar(.62);}});
  addFeed(headshot?'HEADSHOT CONFIRMED':'HOSTILE NEUTRALIZED');
  showToast(`${headshot?'PRECISION HIT':'HOSTILE DOWN'}  +100`);
  setTimeout(()=>{scene.remove(enemy.group);},650);
  if(enemies.every(e=>!e.alive))setTimeout(()=>endRound(true),750);
}
function addFeed(text){
  const el=document.createElement('div');el.className='kill-message';el.innerHTML=`<b>YOU</b> &nbsp;×&nbsp; ${text}`;ui.feed.prepend(el);
  while(ui.feed.children.length>3)ui.feed.lastElementChild.remove();setTimeout(()=>el.remove(),4000);
}
function reload(){
  if(!running||reloadTimer>0||ammo===30||reserveAmmo<=0)return;
  reloadTimer=1.35;ui.reloadStatus.textContent='RELOADING';soundShot(.025,180);
  setTimeout(()=>{if(reloadTimer>0){const count=Math.min(30-ammo,reserveAmmo);ammo+=count;reserveAmmo-=count;reloadTimer=0;ui.reloadStatus.textContent='';updateHud();}},1350);
}
function updateHud(){
  ui.health.textContent=Math.max(0,Math.ceil(health));ui.healthBar.style.width=`${Math.max(0,health)}%`;
  ui.healthBar.style.background=health<30?'#f47766':'var(--lime)';
  ui.ammo.textContent=ammo;ui.reserve.textContent=reserveAmmo;ui.ammoBar.style.width=`${ammo/30*100}%`;
  ui.round.textContent=String(round).padStart(2,'0');
  const m=Math.floor(roundTime/60),s=Math.floor(roundTime%60);ui.timer.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function updatePlayer(dt){
  let forward=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)-input.y;
  let strafe=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+input.x;
  const mag=Math.hypot(forward,strafe);if(mag>1){forward/=mag;strafe/=mag;}
  const moving=mag>.08, speed=(input.sprinting||keys.ShiftLeft||keys.ShiftRight?8.2:5.2);
  const fx=-Math.sin(player.yaw),fz=-Math.cos(player.yaw),rx=Math.cos(player.yaw),rz=-Math.sin(player.yaw);
  moveAgainstWalls(player.pos,(fx*forward+rx*strafe)*speed*dt,(fz*forward+rz*strafe)*speed*dt,.45);
  if(moving)walkPhase+=dt*(input.sprinting?12:8);
  recoil=Math.max(0,recoil-dt*.42);fireTimer=Math.max(0,fireTimer-dt);
  if(input.firing&&fireTimer<=0)tryShoot();
  if(reloadTimer>0){reloadTimer-=dt;if(reloadTimer<=0){const count=Math.min(30-ammo,reserveAmmo);ammo+=count;reserveAmmo-=count;ui.reloadStatus.textContent='';updateHud();}}
  if(muzzleFlash.visible){muzzleFlash.material.opacity-=dt*16;if(muzzleFlash.material.opacity<=0)muzzleFlash.visible=false;}
  camera.position.copy(player.pos);camera.position.y+=moving?Math.sin(walkPhase)*.025:0;
  camera.rotation.set(player.pitch-recoil*.52,player.yaw,0,'YXZ');
  weapon.position.y=-.27+Math.sin(walkPhase*2)*.012+(recoil*.35);
  weapon.position.x=.32+Math.cos(walkPhase)*.009;
}
function enemyCanSee(enemy,dir,distance){
  const origin=enemy.group.position.clone().add(new THREE.Vector3(0,1.3,0));
  raycaster.set(origin,dir);raycaster.far=distance;
  const hits=raycaster.intersectObjects(blockerMeshes,false);
  return !hits.length||hits[0].distance>distance-.8;
}
function updateEnemies(dt){
  for(const enemy of enemies){
    if(!enemy.alive)continue;
    const group=enemy.group,dx=player.pos.x-group.position.x,dz=player.pos.z-group.position.z,dist=Math.hypot(dx,dz);
    group.rotation.y=Math.atan2(-dx,-dz);
    enemy.hit=Math.max(0,enemy.hit-dt);
    if(dist>7.5){
      const forwardX=dx/(dist||1),forwardZ=dz/(dist||1);
      const strafeX=-forwardZ*enemy.strafe,strafeZ=forwardX*enemy.strafe;
      const approach=Math.min(1,(dist-7.5)/6);
      const bx=group.position.x,bz=group.position.z;
      moveAgainstWalls(group.position,(forwardX*approach+strafeX*.22)*enemy.speed*dt,(forwardZ*approach+strafeZ*.22)*enemy.speed*dt,.4);
      if(Math.hypot(group.position.x-bx,group.position.z-bz)<.002)enemy.strafe*=-1;
    }else if(Math.random()<dt*.18)enemy.strafe*=-1;
    enemy.shoot-=dt;
    if(enemy.shoot<=0){
      enemy.shoot=1.8+Math.random()*1.8;
      const target=player.pos.clone().add(new THREE.Vector3(0,-.35,0));
      const origin=group.position.clone().add(new THREE.Vector3(0,1.25,0));
      const delta=target.sub(origin),distance=delta.length(),dir=delta.normalize();
      if(enemyCanSee(enemy,dir,distance)&&Math.random()<.18){
        health=Math.max(0,health-(4+Math.random()*4));damageFlashTimer=.16;
        ui.damage.classList.add('show');setTimeout(()=>ui.damage.classList.remove('show'),120);
        soundShot(.027,105);updateHud();
        if(health<=0){player.alive=false;setTimeout(()=>endRound(false),450);}
      }
      enemy.flash.visible=true;setTimeout(()=>enemy.flash.visible=false,65);
      // A quick distant tracer makes incoming fire readable without cluttering the screen.
      const end=player.pos.clone().add(new THREE.Vector3((Math.random()-.5)*1.5,(Math.random()-.5)*1.2,(Math.random()-.5)*1.5));
      const geo=new THREE.BufferGeometry().setFromPoints([origin,end]);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:'#e99564',transparent:true,opacity:.36}));scene.add(line);bullets.push({line,life:.055,max:.055});
    }
  }
}
function update(dt){
  if(!running)return;
  roundTime-=dt;if(roundTime<=0){roundTime=0;updateHud();endRound(false);return;}
  updatePlayer(dt);updateEnemies(dt);
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.life-=dt;b.line.material.opacity=Math.max(0,b.life/b.max*.8);if(b.life<=0){scene.remove(b.line);b.line.geometry.dispose();b.line.material.dispose();bullets.splice(i,1);}}
  damageFlashTimer=Math.max(0,damageFlashTimer-dt);
  if(Math.floor(roundTime)!==Math.floor(roundTime+dt))updateHud();
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  update(dt);
  if(!running){camera.position.copy(player.pos);camera.rotation.set(player.pitch,player.yaw,0,'YXZ');}
  renderer.render(scene,camera);
}
function resize(){renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}

init();
