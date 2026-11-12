"""Local Firefox QA using installed GeckoDriver and standard-library WebDriver requests."""
import base64,json,os,subprocess,time,urllib.request
import websocket
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
OUT=Path('output/playwright');OUT.mkdir(parents=True,exist_ok=True)
driver=Path.home()/'.cache/selenium/geckodriver/linux64/0.37.1/geckodriver'
proc=subprocess.Popen([str(driver),'--host','127.0.0.1','--port','4447'],stdout=(OUT/'firefox-driver.log').open('w'),stderr=subprocess.STDOUT)
base='http://127.0.0.1:4447';sid=None

def request(method,path,data=None):
 req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=40) as r:res=json.load(r)
 except urllib.error.HTTPError as err:raise RuntimeError(err.read().decode())
 value=res.get('value')
 if isinstance(value,dict) and 'error' in value:raise RuntimeError(value)
 return value

def command(method,path,data=None):return request(method,'/session/'+sid+path,data)
def js(script,args=[]):return command('POST','/execute/sync',{'script':script,'args':args})
def screenshot(name):
 encoded=command('GET','/moz/screenshot/full')
 (OUT/name).write_bytes(base64.b64decode(encoded))
try:
 for _ in range(30):
  try:request('GET','/status');break
  except Exception:time.sleep(.2)
 value=request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'firefox','webSocketUrl':True,'moz:firefoxOptions':{'binary':'/usr/bin/firefox','args':['-headless'],'prefs':{'ui.prefersReducedMotion':1}}}}})
 sid=value['sessionId'];report=[]
 bidi=websocket.create_connection(value['capabilities']['webSocketUrl'],suppress_origin=True);seq=0
 def bidi_command(method,params):
  global seq
  seq+=1;bidi.send(json.dumps({'id':seq,'method':method,'params':params}))
  while True:
   message=json.loads(bidi.recv())
   if message.get('id')==seq:
    if message.get('type')=='error':raise RuntimeError(message)
    return message['result']
 context=bidi_command('browsingContext.getTree',{})['contexts'][0]['context']
 widths=[320,375,414,768,1440]
 for width in widths:
  height={320:812,375:812,414:896,768:1024,1440:1000}[width]
  bidi_command('browsingContext.setViewport',{'context':context,'viewport':{'width':width,'height':height}})
  for filename in json.loads(Path('build-manifest.json').read_text())['pages']:
   command('POST','/url',{'url':'http://127.0.0.1:8000/'+filename})
   command('POST','/execute/async',{'script':'const done=arguments[arguments.length-1]; document.fonts.ready.then(()=>done(true));','args':[]})
   data=js('''return {background:getComputedStyle(document.body).backgroundColor,colorScheme:getComputedStyle(document.documentElement).colorScheme,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length,active:document.querySelectorAll('nav [aria-current="page"]').length,overflow:[...document.querySelectorAll('main *,nav *')].filter(e=>{let r=e.getBoundingClientRect();return !e.closest('svg')&&r.width&&(r.right>innerWidth+1||r.left< -1)}).map(e=>e.tagName+'.'+e.className)}''')
   assert data['colorScheme']=='dark',data
   assert data['background']=='oklch(0.17 0.008 70)',data
   assert data['width']==width and data['height']==height, data
   assert data['scrollWidth']<=width and not data['overflow'], data
   assert js('return getComputedStyle(document.body).fontFamily').split(',')[0].strip("\"' ")=="IBM Plex Sans"
   assert js('return document.fonts.check(\"400 24px IBM Plex Sans\")')
   assert js('return performance.getEntriesByType(\"resource\").every(r=>new URL(r.name).origin===location.origin)')
   assert data['h1']==1 and data['active']==1,data
   screenshot(f'{width}-{filename[:-5]}.png')
   # WebDriver element clicks and key events, rather than scripted activation.
   def element(selector):return command('POST','/element',{'using':'css selector','value':selector})['element-6066-11e4-a52e-4f735466cecf']
   def click(selector):command('POST','/element/'+element(selector)+'/click',{})
   def keys(selector,value):command('POST','/element/'+element(selector)+'/value',{'text':value})
   assert js('return matchMedia("(prefers-reduced-motion: reduce)").matches')
   if filename=='index.html':
    for selector in ['.side-note a[href="blog-playlist.html"]','.work-links a[href="projects.html#trace"]','.work-links a[href="projects.html#hidden-colouring"]','.work-footnote a[href="projects.html#android"]']:
     target=js('return document.querySelector(arguments[0]).href',[selector])
     click(selector);assert command('GET','/url')==target
     command('POST','/url',{'url':'http://127.0.0.1:8000/'+filename})

   # Native pointer hover and pressed state on navigation, with computed-style checks.
   nav_element=element('nav a[href="blog.html"]')
   command('POST','/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','origin':'viewport','x':0,'y':0},{'type':'pointerMove','origin':{'element-6066-11e4-a52e-4f735466cecf':nav_element},'x':0,'y':0,'duration':50},{'type':'pause','duration':100}]}]})
   assert js('return getComputedStyle(document.querySelector(arguments[0])).textDecorationLine',['nav a[href="blog.html"]'])=='underline'
   screenshot(f'{width}-hover-{filename[:-5]}.png')
   command('POST','/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerDown','button':0}]}]})
   assert float(js('return getComputedStyle(document.querySelector(arguments[0])).opacity',['nav a[href="blog.html"]']))==.7
   command('POST','/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerUp','button':0}]}]})
   command('POST','/url',{'url':'http://127.0.0.1:8000/'+filename})
   disclosures=[]
   selectors=js('return [...document.querySelectorAll("details")].map((el,i)=>{el.id="qa-disclosure-"+i;return "#"+el.id+" summary"})')
   for n,selector in enumerate(selectors):
    click(selector);assert js('return document.querySelector(arguments[0]).parentElement.open',[selector])
    screenshot(f'{width}-notes-{n+1}.png')
    keys(selector,'\ue007');assert not js('return document.querySelector(arguments[0]).parentElement.open',[selector])
    command('POST','/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'},{'type':'keyDown','value':'\ue008'},{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'},{'type':'keyUp','value':'\ue008'}]}]})
    assert js('return document.activeElement===document.querySelector(arguments[0])',[selector])
    assert js('return getComputedStyle(document.activeElement).outlineStyle')!='none'
    screenshot(f'{width}-disclosure-focus-{n+1}.png')
    disclosures.append('mouse open / keyboard close / visible focus')
   for target in ['index.html','projects.html','blog.html','resume.html','about.html']:
    click(f'nav a[href="{target}"]');assert command('GET','/url').endswith(target)
   command('POST','/url',{'url':'http://127.0.0.1:8000/'+filename})
   command('POST','/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'}]}]})
   skip=js('return document.activeElement.className')
   if skip!='skip':raise RuntimeError('Skip link focus failed: '+skip)
   screenshot(f'{width}-focus-{filename[:-5]}.png')
   keys('.skip','\ue007');assert command('GET','/url').endswith('#main')
   click('footer a[href="#top"]');assert command('GET','/url').endswith('#top')
   if filename.startswith('blog-'):
    command('POST','/url',{'url':'http://127.0.0.1:8000/'+filename})
    if js('return document.querySelectorAll(".article-index a").length'):
     click('.article-index a');assert '#' in command('GET','/url')
    click('.article-end a');assert command('GET','/url').endswith('blog.html')
   report.append({'page':filename,'viewport':f'{width}x{height}','measurements':data,'navigation':'passed','skipLink':'passed','backToTop':'passed','hover':'passed','pressedState':'passed','reducedMotion':'passed','disclosures':disclosures})
   print(json.dumps(report[-1]),flush=True)
 (OUT/'firefox-report.json').write_text(json.dumps(report,indent=2))
finally:
 if sid:
  try:command('DELETE','')
  except Exception:pass
 proc.terminate();proc.wait(timeout=10)
