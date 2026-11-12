import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class MusicBuildTests(unittest.TestCase):
    def build(self,worker_url):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name)
        for name in ['build.py','blog_engine.py','styles.css','tokens.css','editorial.css','fonts.css']:
            shutil.copy2(ROOT/name,root/name)
        shutil.copytree(ROOT/'assets',root/'assets')
        content=json.loads((ROOT/'content.json').read_text());content['music']['workerUrl']=worker_url
        (root/'content.json').write_text(json.dumps(content))
        result=subprocess.run([sys.executable,str(root/'build.py')],capture_output=True,text=True)
        return root,result

    def test_static_fallback_and_home_only_javascript(self):
        root,result=self.build('');self.assertEqual(result.returncode,0,result.stderr)
        home=(root/'dist/index.html').read_text()
        self.assertIn('data-endpoint=""',home)
        self.assertIn('Listening unavailable',home)
        self.assertIn('blog-playlist.html',home)
        self.assertNotIn('After Hours',home)
        self.assertIn('assets/music.js',home)
        self.assertNotIn('assets/music.js',(root/'dist/projects.html').read_text())
        self.assertEqual(home,(root/'index.html').read_text())

    def test_public_origin_becomes_endpoint_without_credentials(self):
        root,result=self.build('https://music.example.test')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('data-endpoint="https://music.example.test/api/now-playing"',(root/'index.html').read_text())

    def test_concurrent_builds_preserve_stylesheet_and_complete_html(self):
        root,result=self.build('');self.assertEqual(result.returncode,0,result.stderr)
        stylesheet=root/'styles.css'
        original=stylesheet.read_text()
        stylesheet.write_text(original.replace('tokens.css?v=','tokens.css?v=stale'))
        builders=[subprocess.Popen([sys.executable,str(root/'build.py')],stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(4)]
        for builder in builders:
            _,error=builder.communicate();self.assertEqual(builder.returncode,0,error)
        self.assertEqual(stylesheet.read_text(),original)
        self.assertEqual((root/'index.html').read_bytes(),(root/'dist/index.html').read_bytes())
        self.assertTrue((root/'index.html').read_text().endswith('</html>'))

    def test_unsafe_origin_configuration_fails_build(self):
        for value in ['http://music.example.test','javascript:alert(1)','https://secret@music.example.test','https://music.example.test/api/now-playing','https://music.example.test?key=secret']:
            with self.subTest(value=value):
                _,result=self.build(value);self.assertNotEqual(result.returncode,0)

if __name__=='__main__':unittest.main()
