"""Rebuild when Markdown or editable site source changes. Reload the browser to view updates."""
from pathlib import Path
import subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1]
def snapshot():
    files=[ROOT/f for f in ['content.json','tokens.css','styles.css','editorial.css','build.py','blog_engine.py','linkedin_engine.py','fonts.css']]
    files+=list((ROOT/'references/blog').rglob('*'))+list((ROOT/'references/linkedin').rglob('*'))+list((ROOT/'assets').rglob('*'))
    return {str(p):p.stat().st_mtime_ns for p in files if p.is_file()}
def build():
    result=subprocess.run([sys.executable,str(ROOT/'build.py')],cwd=ROOT)
    if result.returncode:print('Build failed; fix the reported source error. Waiting for the next edit.',flush=True)
if __name__=='__main__':
    build();previous=snapshot();print('Watching references/blog/, references/linkedin/, and editable site files. Ctrl+C stops the watcher.',flush=True)
    try:
        while True:
            time.sleep(.75);current=snapshot()
            if current!=previous:build();previous=snapshot()
    except KeyboardInterrupt:pass
