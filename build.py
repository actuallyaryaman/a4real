"""Static portfolio + Markdown blog builder. Run: python3 build.py."""
import hashlib, html, json, re, shutil, tempfile
from pathlib import Path
from urllib.parse import urlparse
from blog_engine import load_posts
ROOT=Path(__file__).parent
def write_atomic(path, text):
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=path.parent,delete=False) as temporary:
        temporary.write(text)
        temporary_path=Path(temporary.name)
    temporary_path.chmod(0o644)
    temporary_path.replace(path)
c=json.loads((ROOT/'content.json').read_text())
posts,warnings=load_posts(ROOT)
def e(value):return html.escape(str(value),quote=True)
def local_or_url(value):
    if not value:return None
    if urlparse(value).scheme in {'https','http','mailto'}:return value
    if value.startswith('assets/') and '..' not in value and (ROOT/value).is_file():return value
    if re.fullmatch(r'(?:writing-(?:workbench|off-the-clock)|blog-[a-z0-9-]+|index|projects|blog|resume|about)\.html(?:#[a-z0-9-]+)?',value):return value
    raise ValueError('Unsupported or missing link: '+value)
def a(label,url,cls='text-link'):
    target=local_or_url(url)
    if target.startswith('mailto:'):icon=''
    elif target.startswith(('https://','http://')):icon='↗'
    elif target.lower().endswith('.pdf'):icon='↓'
    elif label.startswith('Back to') or label=='All writing':icon='←'
    else:icon='→'
    mark=f' <span aria-hidden="true">{icon}</span>' if icon else ''
    return f'<a class="{cls}" href="{e(target)}">{e(label)}{mark}</a>'
def version(path):return hashlib.sha256((ROOT/path).read_bytes()).hexdigest()[:12]
# Version both stylesheets and the imported palette, avoiding stale theme caches.
css=ROOT/'styles.css'
stylesheet=css.read_text()
versioned_stylesheet=re.sub(r"@import url\('tokens\.css(?:\?v=[^']*)?'\);",f"@import url('tokens.css?v={version('tokens.css')}');",stylesheet)
if versioned_stylesheet!=stylesheet:write_atomic(css,versioned_stylesheet)
resume=local_or_url(c['resume'])
email=c['email']
if email and ('@' not in email or any(ch in email for ch in '\n\r?')):raise ValueError('Invalid email')

def article_title(value):
    return e(value).replace('OnePlus 12R','OnePlus\u00a012R').replace('Ace 3','Ace\u00a03')

def project_preview(p):
    if not p.get('preview'):return ''
    if p.get('detailViewBox'):
        visual=f'<svg class="interface-detail" viewBox="{e(p["detailViewBox"])}" role="img" aria-label="{e(p["detailAlt"])}"><image href="{e(p["preview"])}" width="1280" height="900"/></svg>'
        caption=e(p['detailCaption'])
    else:
        visual=f'<img src="{e(p["preview"])}" width="1280" height="900" alt="{e(p["previewAlt"])}" loading="lazy" decoding="async">'
        caption=e(p['previewCaption'])
    return f'<figure class="project-preview">{visual}<figcaption>{caption}<br>{a("View full interface",p["preview"])}</figcaption></figure>'

def project_actions(p,home=False):
    links=[]
    if p.get('demoUrl'):links.append(a(p['demoLabel'],p['demoUrl'],'text-link demo-link'))
    for label,url in [(p.get('linkLabel'),p.get('url')),(p.get('secondaryLabel'),p.get('secondaryUrl'))]:
        if url and url!=p.get('demoUrl'):links.append(a(label,url))
    return '<div class="link-rail project-actions">'+''.join(links)+'</div>'

def project(p,featured=False):
    links=a(p['linkLabel'],p['url']) if p['url'] else ''
    if p.get('secondaryUrl'):links+=a(p['secondaryLabel'],p['secondaryUrl'])
    body=''.join(f'<p>{e(text)}</p>' for text in p.get('body',[]))
    update=f'<details><summary>{e(p["updateLabel"])}</summary><p>{e(p["detail"])}</p></details>' if p.get('updateLabel') else ''
    availability=f'<p class="availability-note">{e(p["availabilityNote"])}</p>' if p.get('availabilityNote') else ''
    diagram=project_preview(p)
    if p.get('detailViewBox'):
        return f'''<article class="case-study case-{e(p['variant'])}" id="{e(p['id'])}"><div class="case-body"><p class="case-meta"><span>{e(p['category'])}</span><span>{e(p['status'])}</span></p><h2>{e(p['title'])}</h2><p class="case-summary">{e(p['summary'])}</p>{project_actions(p)}</div>{diagram}<div class="case-reading"><div class="project-prose">{body}</div>{update}<p class="case-stack">{e(p['context'])}</p>{availability}</div></article>'''
    return f'''<article class="case-study case-{e(p['variant'])}" id="{e(p['id'])}"><div class="case-body"><p class="case-meta"><span>{e(p['category'])}</span><span>{e(p['status'])}</span></p><h2>{e(p['title'])}</h2><p class="case-summary">{e(p['summary'])}</p>{project_actions(p)}<div class="project-prose">{body}</div>{update}<p class="case-stack">{e(p['context'])}</p>{availability}</div>{diagram}</article>'''

def contributions(short=False):
    entries=c['contributions'][:2] if short else c['contributions']
    return '<div class="contribution-list">'+''.join(f'''<article class="contribution"><div class="contribution-meta"><span class="status">{e(p['status'])}</span><span>{e(p['date'])}</span></div><div><h3>{e(p['title'])}</h3><p class="repo-label">{e(p['repo'])}</p><p>{e(p['summary'])}</p><div class="link-rail">{a('Pull request',p['url'])}{a('Follow-up',p['secondaryUrl']) if p.get('secondaryUrl') else ''}</div></div></article>''' for p in entries)+'</div>'

def post_date(p):
    return f'<time datetime="{e(p["date_iso"])}">{e(p["date"])}</time>' if p['date_iso'] else '<span>Undated</span>'
def post_row(p):
    return f'''<article class="post-row"><div class="post-meta">{post_date(p)}<span>{e(' / '.join(p['tags'][:2]))}</span></div><div><h2><a href="blog-{e(p['slug'])}.html">{e(p['title'])}</a></h2><p>{e(p['description'])}</p></div></article>'''

def page_intro(title,intro):
    return f'<header class="wrap document-intro"><h1>{e(title)}</h1><p>{e(intro)}</p></header>'

h=c['home']
music=c.get('music',{})
worker_url=music.get('workerUrl','').rstrip('/')
if worker_url:
    parsed=urlparse(worker_url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
        raise ValueError('music.workerUrl must be an HTTPS origin without a path or credentials')
music_endpoint=worker_url+'/api/now-playing' if worker_url else ''
hero=f'''<section class="wrap welcome" aria-labelledby="name"><div class="welcome-copy"><p class="hello-note">{e(c['heroNote'])}</p><h1 id="name">{e(h['greetingLines'][0])}<br><span>{e(h['greetingLines'][1])}</span></h1><p class="welcome-intro">{e(c['intro'])}</p><div class="lead-actions">{a(h['workLabel'],'projects.html','text-link primary-link')}{a(h['resumeLabel'],resume)}</div></div></section>'''
playlist_note=f'''<aside class="music-card" aria-labelledby="music-heading" data-music data-endpoint="{e(music_endpoint)}" data-state="unavailable"><header class="music-header"><h2 id="music-heading">{e(music.get('heading','On rotation'))}</h2><span class="music-indicator" aria-hidden="true"></span></header><div class="music-cover"><svg class="music-placeholder" viewBox="0 0 160 160" aria-hidden="true"><path d="M27 111V63h22v48m20 21V29h22v103m20-42V70h22v20" fill="currentColor"/><path d="M8 8h144v144H8z" fill="none" stroke="currentColor" stroke-width="1"/></svg><a data-music-art-link hidden aria-label="View artwork source"><img data-music-art width="196" height="196" alt="" hidden referrerpolicy="no-referrer" decoding="async"></a></div><div class="music-info"><p class="music-status" data-music-status>Listening unavailable</p><h3 class="music-title"><a data-music-track hidden></a><span data-music-fallback>Between tracks.</span></h3><p class="music-artist" data-music-artist>Music, across devices.</p><p class="music-album" data-music-album></p></div><p class="music-note" data-music-note aria-live="polite" aria-atomic="true">Listening activity via Last.fm.</p><div class="music-links"><a data-music-profile hidden>Last.fm <span aria-hidden="true">↗</span></a>{a('My playlists','blog-playlist.html')}</div><noscript><p class="music-noscript">Enable JavaScript for listening updates.</p></noscript></aside>'''
selected=[next(p for p in c['projects'] if p['id']==id) for id in h['selectedIds']]
work_home='<section class="wrap editorial-section home-work"><div class="section-title"><h2>'+e(h['selectedHeading'])+'</h2>'+a('All projects','projects.html')+'</div><div class="work-links">'+''.join(f'<article class="work-{e(p["id"])}">{project_preview(p)}<div class="work-copy"><p class="small-label">{e(p["category"])} · {e(p["status"])}</p><h3><a href="projects.html#{e(p["id"])}">{e(p["title"])}</a></h3><p>{e(p["summary"])}</p><p class="home-role">{e(p.get("roleSummary",p["context"]))}</p>{project_actions(p,home=True)}</div></article>' for p in selected)+'</div><div class="work-footnote"><span>'+e(h['workFootnote'])+'</span><div class="link-rail">'+''.join(a(x['label'],x['url']) for x in h['workLinks'])+'</div></div></section>'

featured=posts[0] if posts else None
def featured_post(p):
    return f'<article class="featured-post"><div><p class="small-label">Featured article · {e(" / ".join(p["tags"][:2]))}</p><h2><a href="blog-{e(p["slug"])}.html">{e(p["title"])}</a></h2></div><div><p>{e(p["description"])}</p><p class="feature-date">{post_date(p)} · {p["minutes"]} min read</p>{a("Read the article","blog-"+p["slug"]+".html")}</div></article>'
writing_home='<section class="wrap editorial-section home-writing"><div class="section-title"><h2>'+e(h['writingHeading'])+'</h2>'+a('Browse writing','blog.html')+'</div>'+(featured_post(featured) if featured else '')+''.join(post_row(p) for p in posts if p['slug'] in ['playlist'])+'</section>'
home='<div class="home-opening">'+hero+work_home+playlist_note+'</div>'+writing_home

project_page=page_intro('Things I make & maintain','Security tools, interactive explanations, and Android maintenance.')+'<nav class="wrap project-jumps" aria-label="On this page"><a href="#work">Selected projects</a><a href="#small-tools">Smaller tools</a><a href="#contributions">Open-source contributions</a></nav><section class="wrap project-stories" id="work" aria-label="Selected projects">'+''.join(project(p) for p in c['projects'])+'</section><section class="wrap editorial-section other-work" id="small-tools"><div class="section-title"><h2>Smaller tools</h2></div>'+''.join(f'<article id="{e(p["id"])}"><h3>{e(p["title"])}</h3><p>{e(p["text"])}</p>{a(p["label"],p["url"])}</article>' for p in c['otherWork'] if p['id'] in ['arch','fuelish'])+'</section><section class="wrap editorial-section" id="contributions"><div class="section-title"><h2>Open-source contributions</h2><p class="section-note">Status last checked · October 2026</p></div>'+contributions()+'</section>'

writing_themes=[('workbench','At the workbench','Guides, tools, and project notes.'),('off-the-clock','Off the clock','Music and personal writing.')]
def theme_posts(key):return [p for p in posts if p['theme']==key]
def theme_url(key):return 'writing-'+key+'.html'
blog_page=page_intro(c['blog']['heading'],'Notes from the workbench, and a little outside it.')+'<nav class="wrap writing-themes writing-mobile-index" aria-label="Writing categories">'+''.join(a(label,theme_url(key)) for key,label,_ in writing_themes)+'</nav><div class="wrap writing-columns writing-overview">'+''.join(f'<section class="theme-section" id="{key}" aria-labelledby="{key}-heading"><header class="theme-heading"><h2 id="{key}-heading"><a href="{theme_url(key)}">{e(label)}</a></h2><p>{e(description)}</p></header>'+(''.join(post_row(p) for p in theme_posts(key)[:3]) or '<p class="theme-empty">No notes here yet.</p>')+a(('View the note' if len(theme_posts(key))==1 else 'View all '+str(len(theme_posts(key)))+' notes'),theme_url(key),'text-link theme-all')+'</section>' for key,label,description in writing_themes)+'</div>'


resume_sections=[]
for section in c['resumeSections']:
    items=[]
    for item in section['items']:
        items.append(f'<div class="resume-entry"><h3>{e(item["title"])}</h3>'+(f'<p class="resume-date">{e(item["date"])}</p>' if item['date'] else '')+(f'<p class="resume-org">{e(item["organization"])}</p>' if item['organization'] else '')+''.join(f'<p>{e(text)}</p>' for text in item['paragraphs'])+(f'<div class="resume-source">{a("Source repository",item["url"])}</div>' if item.get('url') else '')+'</div>')
    resume_sections.append(f'<section class="resume-section"><h2>{e(section["title"])}</h2>'+''.join(items)+'</section>')
resume_page=page_intro('Resume','Education, experience, and research.')+f'<section class="wrap resume-layout"><aside><h2>{e(c["name"])}</h2><p>{e(c["institution"])}</p><div class="resume-contact">{a("Download resume PDF",resume)}{"".join(a(address,"mailto:"+address) for address in c.get("resumeEmails",[email]))}'+''.join(a(p['label'],p['url']) for p in c['profileLinks'])+'</div></aside><div>'+(f'<p class="resume-profile">{e(c["resumeProfile"])}</p>' if c.get('resumeProfile') else '')+''.join(resume_sections)+'</div></section>'
about_page=page_intro(c['about']['heading'],c['about']['intro'])+'<section class="wrap about-letter" aria-label="About me">'+''.join(f'<p>{e(text)}</p>' for text in c['about']['paragraphs'])+'</section>'

pages={'index.html':('Home',home,c['description']),'projects.html':('Projects',project_page,'Selected security research, Android maintenance, and verified upstream contributions.'),'blog.html':('Writing',blog_page,c['blog']['intro']),'resume.html':('Resume',resume_page,'Education, internships, research, and certifications of Aryaman Srivastava.'),'about.html':('About',about_page,c['about']['intro'])}
for key,label,description in writing_themes:
    category=page_intro(label,description)+'<div class="wrap category-back">'+a('All writing','blog.html')+'</div><section class="wrap writing-index" aria-label="'+e(label)+'">'+(''.join(post_row(p) for p in theme_posts(key)) or '<p>No notes here yet.</p>')+'</section>'
    pages[theme_url(key)]=(label,category,description)
for post in posts:
    headings=re.findall(r'<h2 id="([^"]+)">(.*?)</h2>',post['html'],re.S)
    toc='<aside class="article-index"><p>In this article</p><nav aria-label="Article contents">'+''.join(f'<a href="#{e(id)}">{html.unescape(re.sub("<[^>]+>","",title))}</a>' for id,title in headings)+'</nav></aside>' if headings else ''
    hero_image=''
    if post['hero']:
        img=post['hero'];hero_image=f'<figure class="article-hero"><img src="{e(img["src"])}" width="{img["width"]}" height="{img["height"]}" alt="{e(img["alt"])}"></figure>'
    article=f'''<header class="wrap article-header">{a('All writing','blog.html')}<p class="article-meta">{post_date(post)}<span>{post['minutes']} min read</span><span>{e(' / '.join(post['tags']))}</span></p><h1>{article_title(post['title'])}</h1><p class="article-description">{e(post['description'])}</p><p class="article-author">By {e(c['name'])}</p></header>{hero_image}<div class="wrap article-layout{' article-no-index' if not headings else ''}">{toc}<article class="article-prose">{post['html']}<div class="article-end">{a('Back to all writing','blog.html')}</div></article></div>'''
    pages[f'blog-{post["slug"]}.html']=(post['title'],article,post['description'])

out=ROOT/'dist';out.mkdir(exist_ok=True)
previous_manifest=ROOT/'build-manifest.json'
if previous_manifest.exists():
    previous_pages=json.loads(previous_manifest.read_text()).get('pages',[])
    for stale in set(previous_pages)-set(pages):
        if re.fullmatch(r'blog-[a-z0-9-]+\.html',stale):
            for directory in (ROOT,out):(directory/stale).unlink(missing_ok=True)

# Retired generated pages must not remain accessible after publishing is disabled.
for retired in c.get('retiredPages',[]):
    if not re.fullmatch(r'[a-z][a-z0-9-]*\.html',retired) or retired in pages:
        raise ValueError('Invalid retired page: '+retired)
    for directory in (ROOT,out):
        (directory/retired).unlink(missing_ok=True)

for filename,(label,body,description) in pages.items():
    title=c['title'] if filename=='index.html' else f'{label} — {c["name"]}'
    canonical=''
    if c.get('siteUrl'):
        url=local_or_url(c['siteUrl']).rstrip('/')+'/'+('' if filename=='index.html' else filename)
        canonical=f'<link rel="canonical" href="{e(url)}"><meta property="og:url" content="{e(url)}">'
    preview=(c['siteUrl'].rstrip('/')+'/' if c.get('siteUrl') else '')+'assets/social-preview.png'
    nav=''.join(f'<a href="{href}"'+(' aria-current="page"' if href==filename or (href=='blog.html' and (filename.startswith('blog-') or filename.startswith('writing-'))) else '')+f'>{text}</a>' for href,text in [('index.html','Home'),('projects.html','Projects'),('blog.html','Writing'),('about.html','About'),('resume.html','Resume')])
    display_font='plex-400'
    music_assets=(f'<link rel="stylesheet" href="assets/music.css?v={version("assets/music.css")}"><script type="module" src="assets/music.js?v={version("assets/music.js")}"></script>' if filename=='index.html' else '')
    page=f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title><meta name="description" content="{e(description)}"><meta name="theme-color" content="#120f0c"><meta property="og:type" content="{'article' if filename.startswith('blog-') else 'website'}"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(description)}"><meta property="og:image" content="{e(preview)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Aryaman Srivastava — Systems &amp; Security"><meta name="twitter:card" content="summary_large_image">{canonical}<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="preload" href="assets/fonts/{display_font}.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="styles.css?v={version('styles.css')}"><link rel="stylesheet" href="editorial.css?v={version('editorial.css')}"><link rel="stylesheet" href="fonts.css?v={version('fonts.css')}">{music_assets}</head><body id="top"><a class="skip" href="#main">Skip to content</a><header class="wrap masthead"><a class="author-mark" href="index.html">Aryaman Srivastava<span aria-hidden="true">.</span></a><nav aria-label="Main navigation">{nav}</nav></header><main id="main" tabindex="-1">{body}</main><footer class="wrap site-footer"><div class="footer-contact"><h2>{e(c['contactHeading'])}</h2>{a(email,'mailto:'+email,'footer-email')}<div class="link-rail">{''.join(a(p['label'],p['url']) for p in c['profileLinks'])}</div></div><div class="footer-bottom"><span>{e(c['name'])}<br><span class="footer-note">MSc Cyber Security · NTU Singapore</span></span><a href="#top">Back to top ↑</a></div></footer></body></html>'''
    write_atomic(ROOT/filename,page);write_atomic(out/filename,page)
for path in ['styles.css','tokens.css','editorial.css','fonts.css']:shutil.copy2(ROOT/path,out/path)
shutil.copytree(ROOT/'assets',out/'assets',dirs_exist_ok=True)
manifest={'pages':list(pages),'posts':[{'slug':p['slug'],'source':p['source'],'title':p['title']} for p in posts],'warnings':warnings}
write_atomic(ROOT/'build-manifest.json',json.dumps(manifest,indent=2)+'\n')
print(f'Built {len(pages)} static pages, including {len(posts)} Markdown posts.')
for warning in warnings:print('NOTE:',warning)
