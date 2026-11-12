"""Curated LinkedIn posts, imported from Markdown without contacting LinkedIn."""
import re
from urllib.parse import urlsplit
import mistune,yaml
from blog_engine import SafeArticle,date_info,slugify

def linkedin_url(value,source,embed=False):
    if not isinstance(value,str):raise ValueError(f'{source}: URL must be text')
    value=value.strip()
    try:
        parts=urlsplit(value)
        valid=parts.scheme=='https' and parts.hostname in {'www.linkedin.com','linkedin.com'} and not parts.username and not parts.password and parts.port in {None,443} and not re.search(r'[\s\\\x00-\x1f]',value)
    except ValueError:valid=False
    if not valid:raise ValueError(f'{source}: use a public HTTPS linkedin.com URL')
    if embed:
        if parts.hostname!='www.linkedin.com' or not re.fullmatch(r'/embed/feed/update/urn:li:(?:activity|share|ugcPost):\d+/?',parts.path):
            raise ValueError(f'{source}: embedUrl must be the src from LinkedIn’s official Embed this post code')
    elif not (parts.path.startswith('/posts/') or parts.path.startswith('/feed/update/')):
        raise ValueError(f'{source}: postUrl must be a post permalink, not a profile or shortened URL')
    return value

def load_linkedin_posts(root):
    posts=[]
    for source in sorted((root/'references/linkedin').glob('**/*.md')):
        text=source.read_text(encoding='utf-8').lstrip('\ufeff')
        match=re.match(r'\A---\s*\n(.*?)\n---\s*(?:\n|$)',text,re.S)
        if not match:raise ValueError(f'{source}: LinkedIn posts require YAML front matter')
        meta=yaml.safe_load(match[1]) or {}
        if not isinstance(meta,dict):raise ValueError(f'{source}: front matter must be a mapping')
        if meta.get('draft') is True:continue
        if not isinstance(meta.get('title'),str) or not meta['title'].strip():raise ValueError(f'{source}: supply a post title')
        slug=slugify(meta.get('slug',re.sub(r'^\d{4}-\d{2}-\d{2}-','',source.stem)))
        if not slug or any(p['slug']==slug for p in posts):raise ValueError(f'{source}: supply a unique slug')
        post_url=linkedin_url(meta.get('postUrl'),source)
        embed_url=linkedin_url(meta['embedUrl'],source,True) if meta.get('embedUrl') else None
        raw_height=meta.get('embedHeight',700)
        try:
            height=int(raw_height)
            if isinstance(raw_height,bool) or height<=0 or str(height)!=str(raw_height).strip():raise ValueError
        except (ValueError,TypeError):raise ValueError(f'{source}: embedHeight must be a positive integer') from None
        label,iso,sort_date=date_info(meta.get('pubDate',meta.get('date')),source.stem)
        rendered=mistune.create_markdown(escape=False,plugins=['table','strikethrough'])(text[match.end():])
        rendered=re.sub(r'(<\/?h)([1-6])(\b)',lambda m:m[1]+str(min(6,int(m[2])+1))+m[3],rendered)
        safe=SafeArticle();safe.feed(rendered)
        posts.append({'title':meta['title'].strip(),'slug':slug,'post_url':post_url,'embed_url':embed_url,'height':height,'date':label,'date_iso':iso,'sort_date':sort_date,'html':''.join(safe.out),'source':str(source.relative_to(root))})
    return sorted(posts,key=lambda p:(p['sort_date'],p['slug']),reverse=True)

def render_linkedin_post(post,labels):
    """Pure renderer, also used by browser fixtures; never emits an initial iframe."""
    from html import escape
    def e(value):return escape(str(value),quote=True)
    slug=e(post['slug']);slot='linkedin-embed-'+slug
    date=f'<time datetime="{e(post["date_iso"])}">{e(post["date"])}</time>' if post['date_iso'] else '<span>Undated</span>'
    button=''
    if post['embed_url']:
        button=f'<button class="embed-toggle" type="button" data-embed-url="{e(post["embed_url"])}" data-title="{e(post["title"])}" data-height="{post["height"]}" data-load-label="{e(labels["loadLabel"])}" data-hide-label="{e(labels["hideLabel"])}" aria-controls="{slot}" aria-expanded="false" hidden>{e(labels["loadLabel"])}</button>'
    return f'''<article class="linkedin-post" id="linkedin-{slug}"><header class="linkedin-post-meta">{date}<span>LinkedIn</span></header><div class="linkedin-post-body"><h2>{e(post['title'])}</h2><div class="linkedin-summary article-prose">{post['html']}</div><div class="linkedin-actions">{button}<a class="text-link linkedin-original" href="{e(post['post_url'])}">View on LinkedIn <span aria-hidden="true">↗</span></a></div><p class="embed-status" aria-live="polite">{'LinkedIn content loads when you choose Load.' if button else 'Read the original post on LinkedIn.'}</p><div class="embed-slot" id="{slot}"></div></div></article>'''
