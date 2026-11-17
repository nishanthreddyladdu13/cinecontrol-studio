from pathlib import Path
import os, json, uuid, time, asyncio
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from .models import Scene, SceneRequest, spatial_warnings

BASE=Path(__file__).resolve().parents[1]
load_dotenv(BASE/'.env')
app=FastAPI(title='CineControl API',version='0.2.0')
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET','POST'],allow_headers=['Content-Type'])
DATA=BASE/'data'/'runs'
SLOTS=asyncio.Semaphore(1)
SYSTEM='''You plan simple indoor film sets. Return only JSON matching the supplied schema.
Units metres; +Y up; origin room centre. Object position is bottom centre. rotation is degrees around Y; 0 faces +Z, 180 faces -Z. Dimensions are width,height,depth.
Support one room, 1-4 characters, up to 20 major objects and 4 shots. Objects: character/table/chair/sofa/bed/counter/shelf/door/window/box. Door and window are filled wall markers, not traversable openings. Place them just inside a wall. Only table supports round shape. Character dimensions nominal 0.6,1.8,0.6 (seated height 1.4); seated poses need explicit chairs if appropriate.
Translate the actual script, never substitute an unrelated example. Record unsupported actions (fights, detailed hand contact, crowds) in unsupported. Inferred details go in assumptions. Preserve stated counts, shapes, names and positions. Interpret behind relative to a character's facing and explain it. Keep cameras inside room, not inside objects; frame subject heads. Keep objects and motion endpoints in bounds. Motion means straight-line position interpolation, not realistic walking. Keep path clear; no pathfinding. Left/right relations refer to world X, not screen. Add explicit supported relations. Request beyond scope: return a useful basic layout and report every omitted detail. No arbitrary code.'''

@app.get('/api/health')
def health():
    provider=os.getenv('LLM_PROVIDER','gemini')
    return {'status':'ok','provider':provider,'model':os.getenv('LLM_MODEL',''),'configured':bool(os.getenv('LLM_API_KEY') and os.getenv('LLM_MODEL')),'video_generation':'manual_external'}
@app.get('/api/schema')
def schema(): return Scene.model_json_schema()
@app.get('/api/examples')
def examples():
    return [json.loads(p.read_text()) for p in sorted((BASE/'examples').glob('*.json'))]
@app.post('/api/validate')
def validate(scene:Scene): return {'scene':scene.model_dump(),'warnings':spatial_warnings(scene)}

async def invoke(prompt:str, *, instructions:str=SYSTEM, schema:dict|None=None)->str:
    json_schema = schema if schema is not None else Scene.model_json_schema()
    key=os.getenv('LLM_API_KEY');model=os.getenv('LLM_MODEL')
    if not key or not model: raise HTTPException(503,'Configure LLM_API_KEY and LLM_MODEL in backend/.env, then restart. Example scenes remain available; no automatic fake generation.')
    provider=os.getenv('LLM_PROVIDER','gemini')
    async with httpx.AsyncClient(timeout=60) as client:
        if provider=='gemini':
            if not all(c.isalnum() or c in '-_.' for c in model): raise HTTPException(500,'Invalid model ID configuration')
            r=await client.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',headers={'x-goog-api-key':key},json={'systemInstruction':{'parts':[{'text':instructions}]},'contents':[{'role':'user','parts':[{'text':prompt}]}],'generationConfig':{'temperature':0.1,'responseMimeType':'application/json','responseJsonSchema':json_schema}})
            r.raise_for_status(); data=r.json()
            return ''.join(p.get('text','') for p in data['candidates'][0]['content']['parts'])
        if provider=='openai_compatible':
            base=os.getenv('LLM_BASE_URL','').rstrip('/')
            if not base.startswith(('https://','http://localhost','http://127.0.0.1')): raise HTTPException(500,'Configure an HTTPS LLM_BASE_URL (or localhost for a local model).')
            r=await client.post(base+'/chat/completions',headers={'Authorization':f'Bearer {key}'},json={'model':model,'messages':[{'role':'system','content':instructions+'\nSchema:\n'+json.dumps(json_schema)},{'role':'user','content':prompt}],'temperature':0.1,'response_format':{'type':'json_object'}})
            r.raise_for_status();return r.json()['choices'][0]['message']['content']
        raise HTTPException(500,'Unsupported LLM_PROVIDER')

@app.post('/api/scene')
async def create_scene(req:SceneRequest):
    if SLOTS.locked(): raise HTTPException(429,'A scene is being generated. Wait for it to finish.')
    async with SLOTS:
        start=time.monotonic();run_id=uuid.uuid4().hex
        record={'run_id':run_id,'script':req.script,'provider':os.getenv('LLM_PROVIDER','gemini'),'model':os.getenv('LLM_MODEL',''),'attempts':[]}
        prompt=req.script
        try:
            for attempt in range(2):
                raw=await invoke(prompt);record['attempts'].append({'raw':raw})
                try:
                    scene=Scene.model_validate_json(raw)
                    warnings=spatial_warnings(scene)
                    if warnings and attempt==0:
                        record['attempts'][-1]['warnings']=warnings
                        prompt=req.script+'\nRepair this draft:\n'+raw+'\nIssues:\n'+json.dumps(warnings);continue
                    scene.description=req.script
                    record.update(status='success',scene=scene.model_dump(),warnings=warnings)
                    return {'run_id':run_id,'scene':scene.model_dump(),'warnings':warnings,'source':'live_model'}
                except ValidationError as exc:
                    errors=exc.errors(include_url=False,include_context=False)
                    record['attempts'][-1]['errors']=errors
                    if attempt: raise HTTPException(422,{'message':'Model returned an invalid scene after repair.','run_id':run_id,'errors':errors})
                    prompt=req.script+'\nRepair this draft:\n'+raw+'\nValidation errors:\n'+json.dumps(errors)
        except (httpx.HTTPError, KeyError, IndexError, ValueError):
            record['status']='provider_error'
            raise HTTPException(502,'Model request failed. Check provider/model, API access, quota and network. No example was substituted.')
        finally:
            record['seconds']=round(time.monotonic()-start,3)
            DATA.mkdir(parents=True,exist_ok=True)
            (DATA/f'{run_id}.json').write_text(json.dumps(record,indent=2),encoding='utf-8')

from .previs import router as previs_router
app.include_router(previs_router)
from .ai_media import router as ai_media_router
app.include_router(ai_media_router)

# Build frontend first for one-server production use. Keep this local unless adding auth/rate limits.
DIST=BASE.parent/'frontend'/'dist'
if DIST.exists(): app.mount('/',StaticFiles(directory=DIST,html=True),name='frontend')
