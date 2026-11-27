#!/usr/bin/env python3
import http.server, os, pathlib, threading, time, json, statistics
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
 for width in [320,360,390,480]:
  page.set_viewport_size({'width':width,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'horizontal overflow at {width}px'
 page.set_viewport_size({'width':390,'height':844})
 visual=page.evaluate('''()=>{const r=window.qartonCinematicRenderer, f=window.__runtimeLastFrame, c=document.querySelector('#screen'),ctx=c.getContext('2d');const before=ctx.getImageData(0,0,c.width,c.height).data;const baseline=r.metrics.lastDraw;r.render({...f,camera:{x:22,y:-8,zoom:1.14,rotation:1}});const after=ctx.getImageData(0,0,c.width,c.height).data;let changed=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])changed++;const characterCounts=[2,4,8].map(count=>{const base=f.scene.characters[0],characters=Array.from({length:count},(_,i)=>({...base,id:`visual-${count}-${i}`,x:(i+1)/(count+1),z:i}));const scene={...f.scene,characters,textScene:{...f.scene.textScene,characters}};const characterAssets=new Map(characters.map(ch=>[ch.id,f.characterAssets.get(base.id)]));r.render({...f,scene,characterAssets});return {requested:count,drawn:r.metrics.lastDraw.drawnCharacterIds.length}});r.render(f);return {drawn:baseline.drawnCharacterIds,backgrounds:baseline.visibleBackgroundIds,changedPixels:changed,characterCounts,renderer:r.metrics}}''')
 assert set(visual['drawn'])=={'layla','youssef'},visual
 assert len(visual['backgrounds'])>=2,visual
 assert visual['changedPixels']>1000,visual
 assert [item['drawn'] for item in visual['characterCounts']]==[2,4,8],visual
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
 page.screenshot(path=str(ARTIFACTS/'cinematic-runtime-mouth-poses.png'),full_page=True)
 page.goto(base,wait_until='networkidle');page.wait_for_function('window.qartonCinematicRuntime')
 page.get_by_role('button',name='إظهار النص كاملًا').click();assert page.locator('#line').inner_text()
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
