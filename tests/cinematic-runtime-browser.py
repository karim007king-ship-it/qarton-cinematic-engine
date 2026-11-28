#!/usr/bin/env python3
import base64, http.server, os, pathlib, threading, time, json, statistics
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT/'dist';ARTIFACTS.mkdir(exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}/examples/cinematic-runtime-lab/'
result={"browser":"Chromium","viewport":"390x844","scenarios":{}}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get("CHROMIUM_PATH"))
 page=browser.new_page(viewport={"width":390,"height":844},device_scale_factor=1)
 page.add_init_script("window.__audioCreated=0; const AC=window.AudioContext; if(AC) window.AudioContext=class extends AC{constructor(...a){super(...a);window.__audioCreated++}}; navigator.mediaDevices.getUserMedia=async()=>{window.__micRequested=(window.__micRequested||0)+1;throw Error('unexpected mic request')};")
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base,wait_until='networkidle');page.wait_for_function('window.qartonCinematicRuntime && document.querySelector("#scene-title").textContent.length>0')
 assert page.locator('#scene-title').inner_text()=='دار على البحر'
 assert page.locator('#screen').evaluate('(c)=>c.width===720&&c.height===1280')
 assert page.evaluate('window.__audioCreated===0 && !window.__micRequested')
 assert page.evaluate('window.qartonCinematicRuntime.assetCount')>=1
 page.evaluate('window.qartonCinematicRuntime.seek(1000)')
 page.wait_for_function('window.__runtimeLastFrame && window.__runtimeLastFrame.timeMs>=1000')
 for width in [320,360,390,480]:
  page.set_viewport_size({'width':width,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'horizontal overflow at {width}px'
 page.set_viewport_size({'width':390,'height':844})
 visual=page.evaluate('''()=>{const r=window.qartonCinematicRenderer, f=window.__runtimeLastFrame, c=document.querySelector('#screen'),ctx=c.getContext('2d');const before=ctx.getImageData(0,0,c.width,c.height).data;const baseline=r.metrics.lastDraw;r.render({...f,camera:{x:22,y:-8,zoom:1.14,rotation:1}});const after=ctx.getImageData(0,0,c.width,c.height).data;let changed=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])changed++;const characterCounts=[2,4,8].map(count=>{const base=f.scene.characters[0],characters=Array.from({length:count},(_,i)=>({...base,id:`visual-${count}-${i}`,x:(i+1)/(count+1),z:i}));const scene={...f.scene,characters,textScene:{...f.scene.textScene,characters}};const characterAssets=new Map(characters.map(ch=>[ch.id,f.characterAssets.get(base.id)]));r.render({...f,scene,characterAssets});return {requested:count,drawn:r.metrics.lastDraw.drawnCharacterIds.length}});r.render(f);return {drawn:baseline.drawnCharacterIds,backgrounds:baseline.visibleBackgroundIds,changedPixels:changed,characterCounts,renderer:r.metrics}}''')
 assert set(visual['drawn'])=={'layla','youssef'},visual
 assert len(visual['backgrounds'])>=2,visual
 assert visual['changedPixels']>1000,visual
 assert [item['drawn'] for item in visual['characterCounts']]==[2,4,8],visual
 actor_pixels=page.evaluate('''()=>{const r=window.qartonCinematicRenderer,f=window.__runtimeLastFrame,c=document.querySelector('#screen'),ctx=c.getContext('2d');r.render(f);const visible=ctx.getImageData(0,0,c.width,c.height).data;r.render({...f,characterAssets:new Map()});const background=ctx.getImageData(0,0,c.width,c.height).data;let changed=0;for(let i=0;i<visible.length;i+=4)if(visible[i]!==background[i]||visible[i+1]!==background[i+1]||visible[i+2]!==background[i+2])changed++;r.render(f);return {changedPixels:changed,drawn:r.metrics.lastDraw.drawnCharacterIds,timeMs:f.timeMs}}''')
 assert len(actor_pixels['drawn'])==2 and actor_pixels['changedPixels']>10000,actor_pixels
 aspect_frames=page.evaluate('''()=>{const f=window.__runtimeLastFrame,Renderer=window.qartonCinematicRenderer.constructor,out=[];for(const [name,width,height] of [['9x16',720,1280],['16x9',1280,720],['4x3',960,720]]){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const renderer=new Renderer(canvas,{quality:'low'}),scene={...f.scene,backgrounds:f.scene.backgrounds.map(layer=>({...layer,fit:layer.role==='foreground'?'contain':'cover'}))};renderer.render({...f,scene,camera:{...f.camera,x:22,y:-8,zoom:1.04,rotation:0}});const ctx=canvas.getContext('2d'),points=[[0,0],[width-1,0],[0,height-1],[width-1,height-1],[Math.floor(width/2),Math.floor(height/2)]],corners=points.map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3));out.push({name,width,height,drawn:renderer.metrics.lastDraw.drawnCharacterIds,corners,png:canvas.toDataURL('image/png')});renderer.dispose()}return out}''')
 assert len(aspect_frames)==3,aspect_frames
 for item in aspect_frames:
  assert len(item['drawn'])==2,item
  assert len({tuple(color) for color in item['corners']})>=3,f"background has an uncovered matte at {item['name']}: {item['corners']}"
  (ARTIFACTS/f"cinematic-runtime-{item['name']}.png").write_bytes(base64.b64decode(item['png'].split(',',1)[1]))
 page.screenshot(path=str(ARTIFACTS/'cinematic-runtime-renderer-visual.png'),full_page=True)
 transition_result=page.evaluate('''async()=>{const r=window.qartonCinematicRenderer,rt=window.qartonCinematicRuntime;for(const id of ['gate','harbor','confrontation','finale'])await rt.loadScene(id);const handle=window.__runtimeLastFrame.transitionHandle;window.__focusTransition=r.transition({from:handle,to:handle,type:'focus',durationMs:500});return {count:r.metrics.transitionCount,scene:rt.getState().sceneId} }''')
 assert transition_result['count']>=3 and transition_result['scene']=='finale',transition_result
 page.wait_for_timeout(180);page.screenshot(path=str(ARTIFACTS/'cinematic-runtime-focus-transition.png'),full_page=True)
 transition_result=page.evaluate('''async()=>({count:window.qartonCinematicRenderer.metrics.transitionCount,focus:await window.__focusTransition,scene:window.qartonCinematicRuntime.getState().sceneId})''')
 assert transition_result['count']>=4 and transition_result['focus'] and transition_result['scene']=='finale',transition_result
 page.goto(base+'layered-character-test.html',wait_until='networkidle')
 try: page.wait_for_function('window.qartonLayeredVisualTest',timeout=5000)
 except Exception as error:
  state=page.evaluate('''()=>({title:document.title,body:document.body.innerText,canvas:document.querySelector('#test-stage')?.toDataURL().slice(0,80),ready:document.readyState})''')
  raise AssertionError(f'layered visual fixture did not initialize; pageErrors={errors}; state={state}') from error
 mouth_hashes=[]
 for pose in ['closed','open','round','wide','teeth']:
  page.locator(f'[data-pose="{pose}"]').click();page.wait_for_timeout(30)
  mouth_hashes.append(page.locator('#test-stage').evaluate('c=>{const d=c.getContext("2d").getImageData(326,570,68,72).data;let h=2166136261;for(let i=0;i<d.length;i+=4){h^=d[i];h=Math.imul(h,16777619);h^=d[i+1];h=Math.imul(h,16777619);h^=d[i+2];h=Math.imul(h,16777619)}return h>>>0}'))
 assert len(set(mouth_hashes))==5,{'mouthHashes':mouth_hashes}
 page.locator('[data-pose="closed"]').click();page.wait_for_timeout(30)
 rig=page.evaluate('''()=>{const layers=window.qartonLayeredVisualTest.lastDraw.characterGeometry.mira,byRole=Object.fromEntries(layers.map(layer=>[layer.role,layer])),bodyTop=byRole.body.anchorY-byRole.body.height*byRole.body.pivotY,headBottom=byRole.head.anchorY+byRole.head.height*(1-byRole.head.pivotY),bodyArmTip=byRole.body.anchorY+byRole.body.height*(.344-byRole.body.pivotY);return {roles:layers.map(layer=>layer.role),headBodyOverlap:headBottom-bodyTop,headHeight:byRole.head.height,leftWristError:Math.abs(byRole.hand_left.anchorY-bodyArmTip),rightWristError:Math.abs(byRole.hand_right.anchorY-bodyArmTip),handHeight:byRole.hand_left.height,facialRotation:new Set(['hair_back','hair_front','eyes','brows','mouth'].map(role=>byRole[role].rotation)).size}}''')
 assert 0<rig['headBodyOverlap']<rig['headHeight']*.15,rig
 assert rig['leftWristError']<rig['handHeight']*.1 and rig['rightWristError']<rig['handHeight']*.1,rig
 assert rig['facialRotation']==1,rig
 roles=rig['roles']
 assert all(roles.index(a)<roles.index(b) for a,b in [('body','hair_back'),('hair_back','head'),('head','hand_left'),('hand_left','hair_front'),('hair_front','eyes'),('eyes','brows'),('brows','mouth')]),roles
 page.screenshot(path=str(ARTIFACTS/'cinematic-runtime-mouth-poses.png'),full_page=True)
 page.goto(base,wait_until='networkidle');page.wait_for_function('window.qartonCinematicRuntime')
 page.evaluate('window.qartonCinematicRuntime.play()')
 page.wait_for_function("document.querySelector('#line').textContent.trim().length>0",timeout=5000)
 page.get_by_role('button',name='إظهار النص كاملًا').click()
 page.wait_for_function("document.querySelector('#line').textContent.includes('قرطاج')",timeout=2000)
 page.evaluate('window.qartonCinematicRuntime.pause()')
 page.get_by_role('button',name='حفظ التقدم').click();assert page.evaluate('Boolean(localStorage.getItem("qarton-cinematic-save"))')
 page.get_by_role('button',name='إيقاف مؤقت').click();page.get_by_role('button',name='تشغيل').click();page.wait_for_timeout(100)
 # Browser rendering/performance window exercises the actual Runtime Canvas and effects.
 seconds=int(os.environ.get('QARTON_RUNTIME_SECONDS','30'))
 scenario=page.evaluate('''async(ms)=>{const rt=window.qartonCinematicRuntime,deltas=[];let lastSample=0;const heapSamples=[],samples=window.__runtimeFrameSamples,start=performance.now(),initial=window.__runtimeFrameCount||0,initialCursor=window.__runtimeFrameSampleCursor||0;await rt.play();while(performance.now()-start<ms){const state=rt.getState();if(state.transport==='waitingForChoice'){const choice=rt.story.byId.get(state.sceneId).choices.find(c=>c.id===state.pendingChoiceId);await rt.selectChoice(choice.options[0].id)}else if(state.transport==='waitingForAdvance')await rt.advanceDialogue();else if(state.transport==='ended')await rt.loadScene('home',{autoplay:true});await new Promise(resolve=>setTimeout(resolve,40));if(performance.now()-lastSample>=5000){heapSamples.push(performance.memory?.usedJSHeapSize??null);lastSample=performance.now()}}await rt.pause();const elapsed=(performance.now()-start)/1000;const frames=(window.__runtimeFrameCount||0)-initial;const state=rt.getState(),cursor=window.__runtimeFrameSampleCursor||0,n=Math.min(frames,samples.length),startAt=frames>samples.length?cursor:initialCursor;const times=Array.from({length:n},(_,i)=>samples[(startAt+i)%samples.length]);for(let i=1;i<times.length;i++)deltas.push(times[i]-times[i-1]);return {elapsedSeconds:elapsed,runtimeFrames:frames,frameDeltas:deltas,scene:state.sceneId,assets:rt.assetCount,leases:rt.assetLeaseCount,decodedImageBytes:rt.decodedAssetBytes,heapSamples,canvasBytes:document.querySelector('#screen').width*document.querySelector('#screen').height*4,frameSampleCapacity:samples.length}}''',seconds*1000)
 samples=scenario['frameDeltas'];slow=sum(1 for ms in samples if ms>33.34)
 heaps=[value for value in scenario['heapSamples'] if value is not None]
 result['scenarios'][f'{seconds}s']={"avgFps":round(scenario['runtimeFrames']/scenario['elapsedSeconds'],2),"p95FrameTimeMs":round(sorted(samples)[min(len(samples)-1,int(.95*(len(samples)-1)))],2) if samples else None,"slowFramesOver33_34ms":slow,"heapStartBytes":heaps[0] if heaps else None,"heapEndBytes":heaps[-1] if heaps else None,"heapPeakBytes":max(heaps) if heaps else None,"heapGrowthBytes":heaps[-1]-heaps[0] if heaps else None,"decodedImageBytes":scenario['decodedImageBytes'],"decodedAssetCount":scenario['assets'],"assetLeaseCount":scenario['leases'],"canvasBytes":scenario['canvasBytes'],"runtimeFrames":scenario['runtimeFrames'],"scene":scenario['scene']}
 assert scenario['leases']<=2 and scenario['assets']<=8
 assert not errors,errors
 assert result['scenarios'][f'{seconds}s']['avgFps']>=30, result
 print(json.dumps(result,ensure_ascii=False,indent=2));browser.close()
 out=ROOT/'dist/cinematic-runtime-performance';out.mkdir(parents=True,exist_ok=True);(out/f"chromium-{seconds}s.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
server.shutdown()
