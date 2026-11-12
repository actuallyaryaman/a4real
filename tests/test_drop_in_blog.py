"""Exercise the actual builder with plain Markdown and no content-list edits."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class DropInBlogTests(unittest.TestCase):
    def test_plain_nested_markdown_builds_links_and_cleans_stale_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ['build.py','blog_engine.py','content.json','styles.css','tokens.css','editorial.css','fonts.css']:
                shutil.copy2(ROOT/name,root/name)
            shutil.copytree(ROOT/'assets',root/'assets')
            folder=root/'references/blog/notes';folder.mkdir(parents=True)
            first=folder/'first.md';first.write_text('# First note\n\nA plain Markdown post.\n\n[Next](second.md#context)\n')
            (folder/'second.md').write_text('# Second note\n\n## Context\n\nMore writing.\n')
            for name in ['a-extra','b-extra','c-extra']:(folder/(name+'.md')).write_text('# '+name+'\n\nAnother guide.\n')
            personal=root/'references/blog/off-the-clock';personal.mkdir()
            (personal/'listening.md').write_text('# Listening note\n\nMusic.\n')
            def build():
                subprocess.run([sys.executable,str(root/'build.py')],cwd=root,check=True,capture_output=True,text=True)
            build()
            archive=(root/'dist/blog.html').read_text()
            self.assertIn('First note',archive);self.assertIn('Second note',archive)
            self.assertIn('Listening note',archive)
            self.assertIn('View all 5 notes',archive)
            self.assertIn('a-extra',(root/'dist/writing-workbench.html').read_text())
            self.assertIn('Listening note',(root/'dist/writing-off-the-clock.html').read_text())
            self.assertNotIn('Listening note',(root/'dist/writing-workbench.html').read_text())
            page=(root/'dist/blog-first.html').read_text()
            self.assertIn('blog-second.html#context',page)
            self.assertIn('mailto:mail@a4real.org',page)
            self.assertEqual(page.count('class="footer-contact"'),1)
            self.assertEqual(json.loads((root/'content.json').read_text()),json.loads((ROOT/'content.json').read_text()))
            first.unlink();build()
            self.assertFalse((root/'blog-first.html').exists())
            self.assertFalse((root/'dist/blog-first.html').exists())
            self.assertNotIn('First note',(root/'dist/blog.html').read_text())

if __name__=='__main__':unittest.main()
