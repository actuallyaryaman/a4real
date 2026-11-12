import tempfile,unittest
from pathlib import Path
from PIL import Image
from blog_engine import load_posts

class MarkdownCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.folder=self.root/'references/blog';self.folder.mkdir(parents=True)
        (self.root/'assets').mkdir()
    def tearDown(self):self.temp.cleanup()
    def write(self,name,body):
        path=self.folder/name;path.write_text(body);return path
    def test_plain_markdown_and_heading_hierarchy(self):
        self.write('2026-10-14-note.md','# A note\n\nBody.\n\n## Context\n\n```python\nprint("hi")\n```\n')
        posts,_=load_posts(self.root);p=posts[0]
        self.assertEqual(p['title'],'A note');self.assertEqual(p['slug'],'note')
        self.assertNotIn('<h1',p['html']);self.assertIn('language-python',p['html'])
        self.assertEqual(p['date_iso'],'2026-10-14')
    def test_themes_from_folders_without_front_matter(self):
        self.write('plain.md','# Plain guide\n\nBody.')
        personal=self.folder/'off-the-clock';personal.mkdir()
        (personal/'listening.md').write_text('# Listening\n\nA personal note.')
        self.write('music.md','---\ntags: [music]\n---\n# Music\n\nBody.')
        posts,_=load_posts(self.root);themes={p['slug']:p['theme'] for p in posts}
        self.assertEqual(themes,{'plain':'workbench','listening':'off-the-clock','music':'off-the-clock'})
    def test_metadata_sorting_precision_and_drafts(self):
        self.write('2026-04-01-one.md','---\ntitle: One\npubDate: Jan 2026\n---\nText.')
        self.write('two.md','---\ntitle: Two\npubDate: 2026-02-01\n---\nText.')
        self.write('draft.md','---\ntitle: Draft\ndraft: true\n---\nNot published.')
        posts,_=load_posts(self.root)
        self.assertEqual([p['title'] for p in posts],['Two','One'])
        self.assertEqual(posts[1]['date_iso'],'2026-01');self.assertEqual(posts[1]['date'],'January 2026')
    def test_commonmark_lists_tables_and_task_items(self):
        self.write('lists.md','Intro:\n- One\n- Two\n\n- [x] Completed\n\n| Column | Value |\n| --- | --- |\n| A | B |')
        posts,_=load_posts(self.root);text=posts[0]['html']
        self.assertIn('<ul>',text);self.assertIn('<li>',text)
        self.assertIn('type="checkbox" disabled checked',text);self.assertIn('<table>',text)
    def test_duplicate_slug_is_actionable_error(self):
        for n in ['a','b']:self.write(n+'.md','---\ntitle: '+n+'\nslug: duplicate\n---\nText.')
        with self.assertRaisesRegex(ValueError,'duplicate blog slug'):load_posts(self.root)
    def test_relative_article_links(self):
        self.write('first.md','[Other post](second.md#context)')
        self.write('second.md','---\ntitle: Second\nslug: other\n---\n## Context\n\nText.')
        posts,_=load_posts(self.root);first=next(p for p in posts if p['slug']=='first')
        self.assertIn('href="blog-other.html#context"',first['html'])
    def test_unsafe_html_removed_but_fenced_text_retained(self):
        self.write('html.md','<script>untrusted()</script>\n\n<a href="javascript:untrusted()" onclick="untrusted()">Link</a>\n\n```html\n<script>example()</script>\n```')
        posts,_=load_posts(self.root);text=posts[0]['html']
        self.assertNotIn('javascript:',text);self.assertNotIn('onclick=',text)
        self.assertNotIn('<script>',text);self.assertIn('&lt;script&gt;',text)
    def test_optional_hero_dimensions_and_missing_image(self):
        Image.new('RGB',(160,90)).save(self.root/'assets/photo.png')
        self.write('hero.md','---\ntitle: Hero\nheroImage: ../../assets/photo.png\nheroImageAlt: A test image\n---\nBody.')
        self.write('missing.md','---\ntitle: Missing\nheroImage: ../../assets/absent.png\n---\nBody.')
        posts,warnings=load_posts(self.root);hero=next(p for p in posts if p['slug']=='hero')['hero']
        self.assertEqual((hero['width'],hero['height']),(160,90));self.assertEqual(len(warnings),1)
        self.assertTrue((self.root/hero['src']).is_file())

if __name__=='__main__':unittest.main()
