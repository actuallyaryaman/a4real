import tempfile, unittest
from pathlib import Path
from linkedin_engine import load_linkedin_posts, linkedin_url, render_linkedin_post

class LinkedInTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name); self.folder=self.root/'references/linkedin'; self.folder.mkdir(parents=True)
 def tearDown(self): self.tmp.cleanup()
 def write(self,name='post.md',extra='',body='A **specific** update.'):
  (self.folder/name).write_text('---\ntitle: Test post\npostUrl: https://www.linkedin.com/posts/test\npubDate: Oct 2026\n'+extra+'---\n'+body)
 def test_link_only_and_month_precision(self):
  self.write(); p=load_linkedin_posts(self.root)[0]
  self.assertIsNone(p['embed_url']); self.assertEqual(p['date'],'October 2026'); self.assertIn('<strong>specific</strong>',p['html'])
 def test_draft_needs_no_other_fields(self):
  (self.folder/'draft.md').write_text('---\ndraft: true\n---\n'); self.assertEqual(load_linkedin_posts(self.root),[])
 def test_nested_discovery_and_duplicate_slug(self):
  (self.folder/'nested').mkdir(); self.write('nested/post.md'); self.write('second.md','slug: post\n')
  with self.assertRaisesRegex(ValueError,'unique slug'): load_linkedin_posts(self.root)
 def test_untrusted_urls_rejected(self):
  for url in ['http://www.linkedin.com/posts/x','https://linkedin.com.evil.test/posts/x','https://user@linkedin.com/posts/x','https://linkedin.com/in/person','javascript:alert(1)','https://linkedin.com:444/posts/x','https://linkedin.com/posts/ bad']:
   with self.subTest(url=url),self.assertRaises(ValueError): linkedin_url(url,'test')
 def test_official_embed_only(self):
  self.assertEqual(linkedin_url('https://www.linkedin.com/embed/feed/update/urn:li:activity:123','test',True),'https://www.linkedin.com/embed/feed/update/urn:li:activity:123')
  for url in ['https://linkedin.com/embed/feed/update/urn:li:activity:123','https://www.linkedin.com/posts/x','https://www.linkedin.com/embed/feed/update/urn:li:activity:abc']:
   with self.assertRaises(ValueError): linkedin_url(url,'test',True)
 def test_invalid_height(self):
  for value in ['-1','true','2.5','nope']:
   self.write(extra='embedHeight: '+value+'\n')
   with self.subTest(value=value),self.assertRaises(ValueError): load_linkedin_posts(self.root)
 def test_summary_sanitization_and_heading(self):
  self.write(body='# Section\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n<a href="javascript:alert(1)" onclick="alert(1)">link</a>')
  html=load_linkedin_posts(self.root)[0]['html']; self.assertIn('<h2>',html)
  for value in ['<script','<iframe','onclick','javascript:']: self.assertNotIn(value,html)
 def test_renderer_no_initial_frame_and_escaped_title(self):
  self.write(extra='embedUrl: https://www.linkedin.com/embed/feed/update/urn:li:activity:123\n'); p=load_linkedin_posts(self.root)[0];p['title']='<unsafe>'
  html=render_linkedin_post(p,{'loadLabel':'Load','hideLabel':'Hide'})
  self.assertNotIn('<iframe',html); self.assertIn(' hidden>',html); self.assertIn('&lt;unsafe&gt;',html); self.assertIn('linkedin-original',html); self.assertIn('aria-expanded="false"',html)

if __name__=='__main__': unittest.main()
