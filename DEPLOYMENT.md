# Publishing on a4real.org

Repository: https://github.com/actuallyaryaman/a4real

GitHub Pages publishes `main` from the repository root, with `www.a4real.org` as its custom domain. The CNAME file preserves that domain for branch publishing.

## One-time setup for automatic Markdown builds

1. Open the repository's Settings → Pages. Change Build and deployment → Source to **GitHub Actions**.
2. In the repository, rename `.github/workflows/pages.yml.example` to `.github/workflows/pages.yml` and commit this to **main**. The template is inactive until renamed. This commit starts the first automated build and publication.
3. Open Actions → Publish portfolio and check the run. You can also use Run workflow to retry manually.
4. In Settings → Pages, change Custom domain to `a4real.org` and save if you want the bare domain to be primary. With an Actions source, the Pages setting controls the domain; the CNAME file is not used. Keep CNAME consistent if you later return to branch publishing.

After setup, drop Markdown into `references/blog/workbench/` or `references/blog/off-the-clock/`, commit, and push to **main**. GitHub installs the build dependencies, runs the tests, generates all archives and pages, and publishes only `dist/`. You do not need to build locally before publishing.

## DNS at your domain provider

For `a4real.org`, set these four A records (host/name `@`):

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | actuallyaryaman.github.io |

Replace conflicting web records for these exact names. Preserve MX/TXT mail records and the separate records for `zk`, `trace`, and `trace2`. If your provider offers proxying, use DNS-only while GitHub verifies the domain and issues its certificate. Once the domain check succeeds, enable **Enforce HTTPS** in Pages settings. DNS and certificate issuance may take time.

Official instructions:
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
