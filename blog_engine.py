"""Build-time Markdown collection; no runtime JavaScript or CMS."""
import html, re, shutil, unicodedata
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit
from html.parser import HTMLParser
import mistune
import yaml
from PIL import Image

class SafeArticle(HTMLParser):
    tags=set('p br hr h2 h3 h4 h5 h6 a strong em del code pre blockquote ul ol li table thead tbody tr th td img div span details summary sup sub'.split())
    void={'br','hr','img','input'}
    def __init__(self):super().__init__(convert_charrefs=False);self.out=[];self.blocked=0
    def handle_starttag(self,tag,attrs):
        if tag in {'script','style','iframe','object'}:self.blocked+=1;return
        if tag=='input' and not self.blocked:
            values=dict(attrs)
            if values.get('type')=='checkbox':self.out.append('<input type="checkbox" disabled'+(' checked' if 'checked' in values else '')+'>')
            return
        if self.blocked or tag not in self.tags:return
        clean=[]
        for name,value in attrs:
            if name not in {'href','src','alt','title','id','class','width','height','loading','start','colspan','rowspan'}:continue
            if name in {'href','src'} and urlsplit(value or '').scheme not in {'','https','http','mailto'}:continue
            clean.append(f'{name}="{html.escape(value or "",quote=True)}"')
        self.out.append('<'+tag+(' '+' '.join(clean) if clean else '')+'>')
    def handle_endtag(self,tag):
        if tag in {'script','style','iframe','object'}:self.blocked=max(0,self.blocked-1);return
        if not self.blocked and tag in self.tags and tag not in self.void:self.out.append('</'+tag+'>')
    def handle_data(self,data):
        if not self.blocked:self.out.append(html.escape(data,quote=False))
    def handle_entityref(self,name):
        if not self.blocked:self.out.append('&'+name+';')
    def handle_charref(self,name):
        if not self.blocked:self.out.append('&#'+name+';')

def slugify(text):
    text=unicodedata.normalize('NFKD',str(text)).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',text).strip('-')

def date_info(value,filename):
    raw=str(value or '').strip()
    if not raw:
        match=re.match(r'(\d{4}-\d{2}-\d{2})',filename)
        raw=match[1] if match else ''
    for fmt in ['%Y-%m-%d','%b %d %Y','%B %d %Y','%b %Y','%B %Y','%Y']:
        try:
            parsed=datetime.strptime(raw,fmt)
            precision=4 if fmt=='%Y' else 7 if fmt in ['%b %Y','%B %Y'] else 10
            iso=parsed.date().isoformat()[:precision]
            label=parsed.strftime('%Y') if precision==4 else parsed.strftime('%B %Y') if precision==7 else f'{parsed.day} {parsed.strftime("%B %Y")}'
            return label,iso,parsed.date()
        except ValueError:pass
    if raw:raise ValueError(f'{filename}: unsupported pubDate/date {raw!r}; use YYYY-MM-DD, Mon YYYY, or YYYY')
    return '', '', date.min

def load_posts(root):
    folder=root/'references/blog';posts=[];warnings=[]
    for source in sorted(folder.glob('**/*.md')):
        text=source.read_text(encoding='utf-8').lstrip('\ufeff');meta={};body=text
        match=re.match(r'\A---\s*\n(.*?)\n---\s*(?:\n|$)',text,re.S)
        if match:
            meta=yaml.safe_load(match[1]) or {};body=text[match.end():]
            if not isinstance(meta,dict):raise ValueError(f'{source}: front matter must be a mapping')
        if meta.get('draft') is True:continue
        body=re.sub(r'^\s*---\s*\n','',body,count=1)
        fallback=re.sub(r'^\d{4}-\d{2}-\d{2}-','',source.stem)
        heading=re.search(r'^#\s+(.+)$',body,re.M)
        title=str(meta.get('title') or (heading[1] if heading else fallback.replace('-',' ').capitalize()))
        slug=slugify(meta.get('slug',fallback))
        if not slug:raise ValueError(f'{source}: supply a valid slug')
        if any(p['slug']==slug for p in posts):raise ValueError(f'{source}: duplicate blog slug {slug}')
        # Avoid repeating a front-matter title as the opening Markdown heading.
        first_heading=re.match(r'^\s*#\s+(.+)\n',body)
        if first_heading and (slugify(first_heading[1])==slugify(title) or slugify(first_heading[1]).startswith(slugify(title)+'-')):
            body=body[first_heading.end():]
        description=str(meta.get('description',meta.get('summary',''))).strip()
        if not description:
            paragraphs=re.split(r'\n\s*\n',body.strip())
            candidate=next((p for p in paragraphs if p and not p.startswith(('#','```','---','- ','>'))),'')
            description=re.sub(r'[*_`\[\]]','',candidate.replace('\n',' '))[:180]
        label,iso,sort_date=date_info(meta.get('pubDate',meta.get('date')),source.stem)
        # One title per page. Article headings are subordinate to the template h1.
        rendered=mistune.create_markdown(escape=False,plugins=['table','strikethrough','footnotes','task_lists'])(body)
        levels=[int(x) for x in re.findall(r'<h([1-6])\b',rendered)]
        offset=2-min(levels) if levels else 0
        rendered=re.sub(r'(<\/?h)([1-6])(\b)',lambda m:m[1]+str(min(6,int(m[2])+offset))+m[3],rendered)
        heading_ids=set()
        def identify_heading(match):
            level,title=match[1],match[2]
            base=slugify(html.unescape(re.sub('<[^>]+>','',title))) or 'section'
            identifier=base;suffix=2
            while identifier in heading_ids:identifier=f'{base}-{suffix}';suffix+=1
            heading_ids.add(identifier)
            return f'<h{level} id="{identifier}">{title}</h{level}>'
        rendered=re.sub(r'<h([2-6])>(.*?)</h\1>',identify_heading,rendered,flags=re.S)
        parser=SafeArticle();parser.feed(rendered);rendered=''.join(parser.out)
        tags=meta.get('tags',[])
        if isinstance(tags,str):tags=[tags]
        folders=source.relative_to(folder).parts[:-1]
        personal='off-the-clock' in folders or any(str(tag).lower() in {'music','philosophy','personal'} for tag in tags)
        theme='off-the-clock' if personal else 'workbench'
        words=len(re.findall(r'\w+',re.sub('<[^>]+>',' ',rendered)))
        hero=None
        if meta.get('heroImage'):
            image_path=(source.parent/str(meta['heroImage'])).resolve()
            if image_path.is_file() and image_path.is_relative_to(root.resolve()):
                with Image.open(image_path) as img:
                    width,height=img.size
                target=root/'assets/blog'/f'{slug}{image_path.suffix.lower()}';target.parent.mkdir(exist_ok=True)
                if image_path!=target.resolve():shutil.copy2(image_path,target)
                hero={'src':str(target.relative_to(root)),'width':width,'height':height,'alt':str(meta.get('heroImageAlt',''))}
            else:warnings.append(f'{source.name}: hero image not supplied ({meta["heroImage"]}); omitted')
        posts.append({'title':title,'slug':slug,'description':description,'date':label,'date_iso':iso,'sort_date':sort_date,'theme':theme,'tags':[str(t) for t in tags],'html':rendered,'minutes':max(1,(words+219)//220),'hero':hero,'source':str(source.relative_to(root))})
    by_source={(root/p['source']).resolve():p for p in posts}
    for post in posts:
        def relative_article_link(match):
            value=html.unescape(match[1]);parts=urlsplit(value)
            if parts.scheme or not parts.path.endswith('.md'):return match[0]
            source=(root/post['source']).parent/parts.path
            target=by_source.get(source.resolve())
            if not target:
                warnings.append(f'{post["source"]}: linked Markdown post not published: {value}')
                return match[0]
            return 'href="blog-'+target['slug']+'.html'+('#'+html.escape(parts.fragment,quote=True) if parts.fragment else '')+'"'
        post['html']=re.sub(r'href="([^"]+)"',relative_article_link,post['html'])
    posts.sort(key=lambda p:(p['sort_date'],p['slug']),reverse=True)
    return posts,warnings
