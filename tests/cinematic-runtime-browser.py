#!/usr/bin/env python3
import http.server, os, pathlib, threading, time, json, statistics
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
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
 page.get_by_role('button',name='إظهار النص كاملًا').click();assert page.locator('#line').inner_text()
 page.get_by_role('button',name='حفظ التقدم').click();assert page.evaluate('Boolean(localStorage.getItem("qarton-cinematic-save"))')
 page.get_by_role('button',name='إيقاف مؤقت').click();page.get_by_role('button',name='تشغيل').click();page.wait_for_timeout(100)
 # Browser rendering/performance window exercises the actual Runtime Canvas and effects.
 seconds=int(os.environ.get('QARTON_RUNTIME_SECONDS','30'))
 scenario=page.evaluate('''async(ms)=>{const rt=window.qartonCinematicRuntime,deltas=[];let previous=0,lastSample=0;const heapSamples=[],start=performance.now(),initial=window.__runtimeFrameCount||0,initialTimeIndex=(window.__runtimeFrameTimes||[]).length;await rt.play();while(performance.now()-start<ms){const state=rt.getState();if(state.transport==='waitingForChoice'){const choice=rt.story.byId.get(state.sceneId).choices.find(c=>c.id===state.pendingChoiceId);await rt.selectChoice(choice.options[0].id)}else if(state.transport==='waitingForAdvance')await rt.advanceDialogue();else if(state.transport==='ended')await rt.loadScene('home',{autoplay:true});await new Promise(resolve=>setTimeout(resolve,40));if(performance.now()-lastSample>=5000){heapSamples.push(performance.memory?.usedJSHeapSize??null);lastSample=performance.now()}}await rt.pause();const elapsed=(performance.now()-start)/1000;const frames=(window.__runtimeFrameCount||0)-initial;const state=rt.getState();const times=(window.__runtimeFrameTimes||[]).slice(initialTimeIndex);for(let i=1;i<times.length;i++)deltas.push(times[i]-times[i-1]);return {elapsedSeconds:elapsed,runtimeFrames:frames,frameDeltas:deltas,scene:state.sceneId,assets:rt.assetCount,leases:rt.assetLeaseCount,decodedImageBytes:rt.decodedAssetBytes,heapSamples,canvasBytes:document.querySelector('#screen').width*document.querySelector('#screen').height*4}}''',seconds*1000)
 samples=scenario['frameDeltas'];slow=sum(1 for ms in samples if ms>33.34)
 heaps=[value for value in scenario['heapSamples'] if value is not None]
 result['scenarios'][f'{seconds}s']={"avgFps":round(scenario['runtimeFrames']/scenario['elapsedSeconds'],2),"p95FrameTimeMs":round(sorted(samples)[min(len(samples)-1,int(.95*(len(samples)-1)))],2) if samples else None,"slowFramesOver33_34ms":slow,"heapStartBytes":heaps[0] if heaps else None,"heapEndBytes":heaps[-1] if heaps else None,"heapPeakBytes":max(heaps) if heaps else None,"heapGrowthBytes":heaps[-1]-heaps[0] if heaps else None,"decodedImageBytes":scenario['decodedImageBytes'],"decodedAssetCount":scenario['assets'],"assetLeaseCount":scenario['leases'],"canvasBytes":scenario['canvasBytes'],"runtimeFrames":scenario['runtimeFrames'],"scene":scenario['scene']}
 assert scenario['leases']<=2 and scenario['assets']<=6
 assert not errors,errors
 assert result['scenarios'][f'{seconds}s']['avgFps']>=30, result
 print(json.dumps(result,ensure_ascii=False,indent=2));browser.close()
 out=ROOT/'dist/cinematic-runtime-performance';out.mkdir(parents=True,exist_ok=True);(out/f"chromium-{seconds}s.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
server.shutdown()
